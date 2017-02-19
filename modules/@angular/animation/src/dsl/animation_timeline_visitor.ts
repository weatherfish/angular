/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {AnimationStyles} from '@angular/core';
import {StyleData} from '../common/style_data';
import {copyStyles, normalizeStyles, parseTimeExpression} from '../common/util';
import {AnimationDslVisitor, visitAnimationNode} from './animation_dsl_visitor';
import * as meta from './animation_metadata';
import {AnimationTimelineInstruction, createTimelineInstruction} from './animation_timeline_instruction';

/*
 * The code within this file aims to generate web-animations-compatible keyframes from Angular's
 * animation DSL code.
 *
 * The code below will be converted from:
 *
 * ```
 * sequence([
 *   style({ opacity: 0 }),
 *   animate(1000, style({ opacity: 0 }))
 * ])
 * ```
 *
 * To:
 * ```
 * keyframes = [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 1 }]
 * duration = 1000
 * delay = 0
 * easing = ''
 * ```
 *
 * For this operation to cover the combination of animation verbs (style, animate, group, etc...) a
 * combination of prototypical inheritance, AST traversal and merge-sort-like algorithms are used.
 *
 * [AST Traversal]
 * Each of the animation verbs, when executed, will return an string-map object representing what
 * type of action it is (style, animate, group, etc...) and the data associated with it. This means
 * that when functional composition mix of these functions is evaluated (like in the example above)
 * then it will end up producing a tree of objects representing the animation itself.
 *
 * When this animation object tree is processed by the visitor code below it will visit each of the
 * verb statements within the visitor. And during each visit it will build the context of the
 * animation keyframes by interacting with the `TimelineBuilder`.
 *
 * [TimelineBuilder]
 * This class is responsible for tracking the styles and building a series of keyframe objects for a
 * timeline between a start and end time. The builder starts off with an initial timeline and each
 * time the AST comes across a `group()`, `keyframes()` or a combination of the two wihtin a
 * `sequence()` then it will generate a sub timeline for each step as well as a new one after
 * they are complete.
 *
 * As the AST is traversed, the timing state on each of the timelines will be incremented. If a sub
 * timeline was created (based on one of the cases above) then the parent timeline will attempt to
 * merge the styles used within the sub timelines into itself (only with group() this will happen).
 * This happens with a merge operation (much like how the merge works in mergesort) and it will only
 * copy the most recently used styles from the sub timelines into the parent timeline. This ensures
 * that if the styles are used later on in another phase of the animation then they will be the most
 * up-to-date values.
 *
 * [How Missing Styles Are Updated]
 * Each timeline has a `backFill` property which is responsible for filling in new styles into
 * already processed keyframes if a new style shows up later within the animation sequence.
 *
 * ```
 * sequence([
 *   style({ width: 0 }),
 *   animate(1000, style({ width: 100 })),
 *   animate(1000, style({ width: 200 })),
 *   animate(1000, style({ width: 300 }))
 *   animate(1000, style({ width: 400, height: 400 })) // notice how `height` doesn't exist anywhere
 * else
 * ])
 * ```
 *
 * What is happening here is that the `height` value is added later in the sequence, but is missing
 * from all previous animation steps. Therefore when a keyframe is created it would also be missing
 * from all previous keyframes up until where it is first used. For the timeline keyframe generation
 * to properly fill in the style it will place the previous value (the value from the parent
 * timeline) or a default value of `*` into the backFill object. Given that each of the keyframe
 * styles are objects that prototypically inhert from the backFill object, this means that if a
 * value is added into the backFill then it will automatically propagate any missing values to all
 * keyframes. Therefore the missing `height` value will be properly filled into the already
 * processed keyframes.
 *
 * When a sub-timeline is created it will have its own backFill property. This is done so that
 * styles present within the sub-timeline do not accidentally seep into the previous/future timeline
 * keyframes
 *
 * (For prototypically-inherited contents to be detected a `for(i in obj)` loop must be used.)
 *
 * [Validation]
 * The code in this file is not responsible for validation. That functionality happens with within
 * the `AnimationValidatorVisitor` code.
 */
export function buildAnimationKeyframes(
    ast: meta.AnimationMetadata | meta.AnimationMetadata[], startingStyles: StyleData = {},
    finalStyles: StyleData = {}): AnimationTimelineInstruction[] {
  const normalizedAst = Array.isArray(ast) ? meta.sequence(<meta.AnimationMetadata[]>ast) :
                                             <meta.AnimationMetadata>ast;
  return new AnimationTimelineVisitor().buildKeyframes(normalizedAst, startingStyles, finalStyles);
}

export declare type StyleAtTime = {
  time: number; value: string | number;
};

export class AnimationTimelineContext {
  currentTimeline: TimelineBuilder;
  currentAnimateTimings: meta.AnimateTimings;
  previousNode: meta.AnimationMetadata = <meta.AnimationMetadata>{};
  subContextCount = 0;

  constructor(
      public errors: any[], public timelines: TimelineBuilder[],
      initialTimeline: TimelineBuilder = null) {
    this.currentTimeline = initialTimeline || new TimelineBuilder(0);
    timelines.push(this.currentTimeline);
  }

  createSubContext(): AnimationTimelineContext {
    const context =
        new AnimationTimelineContext(this.errors, this.timelines, this.currentTimeline.fork());
    context.previousNode = this.previousNode;
    context.currentAnimateTimings = this.currentAnimateTimings;
    this.subContextCount++;
    return context;
  }

  transformIntoNewTimeline(newTime = 0) {
    this.currentTimeline = this.currentTimeline.fork(newTime);
    this.timelines.push(this.currentTimeline);
    return this.currentTimeline;
  }

  incrementTime(time: number) {
    this.currentTimeline.forwardTime(this.currentTimeline.duration + time);
  }
}

export class AnimationTimelineVisitor implements AnimationDslVisitor {
  buildKeyframes(ast: meta.AnimationMetadata, startingStyles: StyleData, finalStyles: StyleData):
      AnimationTimelineInstruction[] {
    const context = new AnimationTimelineContext([], []);
    context.currentTimeline.setStyles(startingStyles);

    visitAnimationNode(this, ast, context);
    const normalizedFinalStyles = copyStyles(finalStyles, true);

    // this is a special case for when animate(TIME) is used (without any styles)
    // thus indicating to create an animation arc between the final keyframe and
    // the destination styles. When this occurs we need to ensure that the styles
    // that are missing on the finalStyles map are set to AUTO
    if (Object.keys(context.currentTimeline.getFinalKeyframe()).length == 0) {
      context.currentTimeline.properties.forEach(prop => {
        const val = normalizedFinalStyles[prop];
        if (val == null) {
          normalizedFinalStyles[prop] = meta.AUTO_STYLE;
        }
      });
    }

    context.currentTimeline.setStyles(normalizedFinalStyles);
    const timelineInstructions: AnimationTimelineInstruction[] = [];
    context.timelines.forEach(timeline => {
      // this checks to see if an actual animation happened
      if (timeline.hasStyling()) {
        timelineInstructions.push(timeline.buildKeyframes());
      }
    });

    if (timelineInstructions.length == 0) {
      timelineInstructions.push(createTimelineInstruction([], 0, 0, ''));
    }
    return timelineInstructions;
  }

  visitState(ast: meta.AnimationStateMetadata, context: any): any {
    // these values are not visited in this AST
  }

  visitTransition(ast: meta.AnimationTransitionMetadata, context: any): any {
    // these values are not visited in this AST
  }

  visitSequence(ast: meta.AnimationSequenceMetadata, context: AnimationTimelineContext) {
    const subContextCount = context.subContextCount;
    if (context.previousNode.type == meta.AnimationMetadataType.Style) {
      context.currentTimeline.forwardFrame();
      context.currentTimeline.snapshotCurrentStyles();
    }

    ast.steps.forEach(s => visitAnimationNode(this, s, context));

    // this means that some animation function within the sequence
    // ended up creating a sub timeline (which means the current
    // timeline cannot overlap with the contents of the sequence)
    if (context.subContextCount > subContextCount) {
      context.transformIntoNewTimeline();
    }

    context.previousNode = ast;
  }

  visitGroup(ast: meta.AnimationGroupMetadata, context: AnimationTimelineContext) {
    const innerTimelines: TimelineBuilder[] = [];
    let furthestTime = context.currentTimeline.currentTime;
    ast.steps.forEach(s => {
      const innerContext = context.createSubContext();
      visitAnimationNode(this, s, innerContext);
      furthestTime = Math.max(furthestTime, innerContext.currentTimeline.currentTime);
      innerTimelines.push(innerContext.currentTimeline);
    });

    // this operation is run after the AST loop because otherwise
    // if the parent timeline's collected styles were updated then
    // it would pass in invalid data into the new-to-be forked items
    innerTimelines.forEach(
        timeline => context.currentTimeline.mergeTimelineCollectedStyles(timeline));
    context.transformIntoNewTimeline(furthestTime);
    context.previousNode = ast;
  }

  visitAnimate(ast: meta.AnimationAnimateMetadata, context: AnimationTimelineContext) {
    const timings = ast.timings.hasOwnProperty('duration') ?
        <meta.AnimateTimings>ast.timings :
        parseTimeExpression(<string|number>ast.timings, context.errors);
    context.currentAnimateTimings = timings;

    if (timings.delay) {
      context.incrementTime(timings.delay);
      context.currentTimeline.snapshotCurrentStyles();
    }

    const astType = ast.styles ? ast.styles.type : -1;
    if (astType == meta.AnimationMetadataType.KeyframeSequence) {
      this.visitKeyframeSequence(<meta.AnimationKeyframesSequenceMetadata>ast.styles, context);
    } else {
      context.incrementTime(timings.duration);
      if (astType == meta.AnimationMetadataType.Style) {
        this.visitStyle(<meta.AnimationStyleMetadata>ast.styles, context);
      }
    }

    context.currentAnimateTimings = null;
    context.previousNode = ast;
  }

  visitStyle(ast: meta.AnimationStyleMetadata, context: AnimationTimelineContext) {
    // this is a special case when a style() call is issued directly after
    // a call to animate(). If the clock is not forwarded by one frame then
    // the style() calls will be merged into the previous animate() call
    // which is incorrect.
    if (!context.currentAnimateTimings &&
        context.previousNode.type == meta.AnimationMetadataType.Animate) {
      context.currentTimeline.forwardFrame();
    }

    const normalizedStyles = normalizeStyles(new AnimationStyles(ast.styles));
    const easing = context.currentAnimateTimings && context.currentAnimateTimings.easing;
    if (easing) {
      normalizedStyles['easing'] = easing;
    }

    context.currentTimeline.setStyles(normalizedStyles);
    context.previousNode = ast;
  }

  visitKeyframeSequence(
      ast: meta.AnimationKeyframesSequenceMetadata, context: AnimationTimelineContext) {
    const MAX_KEYFRAME_OFFSET = 1;
    const limit = ast.steps.length - 1;
    const firstKeyframe = ast.steps[0];

    let offsetGap = 0;
    const containsOffsets = firstKeyframe.styles.find(styles => styles['offset'] >= 0);
    if (!containsOffsets) {
      offsetGap = MAX_KEYFRAME_OFFSET / limit;
    }

    const startTime = context.currentTimeline.duration;
    const duration = context.currentAnimateTimings.duration;
    const innerContext = context.createSubContext();
    const innerTimeline = innerContext.currentTimeline;
    innerTimeline.easing = context.currentAnimateTimings.easing;

    ast.steps.forEach((step: meta.AnimationStyleMetadata, i: number) => {
      const normalizedStyles = normalizeStyles(new AnimationStyles(step.styles));
      const offset = containsOffsets ? <number>normalizedStyles['offset'] :
                                       (i == limit ? MAX_KEYFRAME_OFFSET : i * offsetGap);
      innerTimeline.forwardTime(offset * duration);
      innerTimeline.setStyles(normalizedStyles);
    });

    // this will ensure that the parent timeline gets all the styles from
    // the child even if the new timeline below is not used
    context.currentTimeline.mergeTimelineCollectedStyles(innerTimeline);

    // we do this because the window between this timeline and the sub timeline
    // should ensure that the styles within are exactly the same as they were before
    context.transformIntoNewTimeline(startTime + duration);
    context.previousNode = ast;
  }
}

export class TimelineBuilder {
  public duration: number = 0;
  public easing: string = '';
  private _currentKeyframe: StyleData;
  private _keyframes = new Map<number, StyleData>();
  private _styleSummary: {[prop: string]: StyleAtTime} = {};
  private _localTimelineStyles: StyleData;
  private _backFill: StyleData = {};

  constructor(public startTime: number, private _globalTimelineStyles: StyleData = null) {
    this._localTimelineStyles = Object.create(this._backFill, {});
    if (!this._globalTimelineStyles) {
      this._globalTimelineStyles = this._localTimelineStyles;
    }
    this._loadKeyframe();
  }

  hasStyling(): boolean { return this._keyframes.size > 1; }

  get currentTime() { return this.startTime + this.duration; }

  fork(currentTime = 0): TimelineBuilder {
    return new TimelineBuilder(currentTime || this.currentTime, this._globalTimelineStyles);
  }

  private _loadKeyframe() {
    this._currentKeyframe = this._keyframes.get(this.duration);
    if (!this._currentKeyframe) {
      this._currentKeyframe = Object.create(this._backFill, {});
      this._keyframes.set(this.duration, this._currentKeyframe);
    }
  }

  forwardFrame() {
    this.duration++;
    this._loadKeyframe();
  }

  forwardTime(time: number) {
    this.duration = time;
    this._loadKeyframe();
  }

  private _updateStyle(prop: string, value: string|number) {
    if (prop != 'easing') {
      this._localTimelineStyles[prop] = value;
      this._globalTimelineStyles[prop] = value;
      this._styleSummary[prop] = {time: this.currentTime, value};
    }
  }

  setStyles(styles: StyleData) {
    Object.keys(styles).forEach(prop => {
      if (prop !== 'offset') {
        const val = styles[prop];
        this._currentKeyframe[prop] = val;
        if (prop !== 'easing' && !this._localTimelineStyles[prop]) {
          this._backFill[prop] = this._globalTimelineStyles[prop] || meta.AUTO_STYLE;
        }
        this._updateStyle(prop, val);
      }
    });
    Object.keys(this._localTimelineStyles).forEach(prop => {
      if (!this._currentKeyframe.hasOwnProperty(prop)) {
        this._currentKeyframe[prop] = this._localTimelineStyles[prop];
      }
    });
  }

  snapshotCurrentStyles() { copyStyles(this._localTimelineStyles, false, this._currentKeyframe); }

  getFinalKeyframe() { return this._keyframes.get(this.duration); }

  get properties() {
    const properties: string[] = [];
    for (let prop in this._currentKeyframe) {
      properties.push(prop);
    }
    return properties;
  }

  mergeTimelineCollectedStyles(timeline: TimelineBuilder) {
    Object.keys(timeline._styleSummary).forEach(prop => {
      const details0 = this._styleSummary[prop];
      const details1 = timeline._styleSummary[prop];
      if (!details0 || details1.time > details0.time) {
        this._updateStyle(prop, details1.value);
      }
    });
  }

  buildKeyframes(): AnimationTimelineInstruction {
    const finalKeyframes: StyleData[] = [];
    // special case for when there are only start/destination
    // styles but no actual animation animate steps...
    if (this.duration == 0) {
      const targetKeyframe = this.getFinalKeyframe();

      const firstKeyframe = copyStyles(targetKeyframe, true);
      firstKeyframe['offset'] = 0;
      finalKeyframes.push(firstKeyframe);

      const lastKeyframe = copyStyles(targetKeyframe, true);
      lastKeyframe['offset'] = 1;
      finalKeyframes.push(lastKeyframe);
    } else {
      this._keyframes.forEach((keyframe, time) => {
        const finalKeyframe = copyStyles(keyframe, true);
        finalKeyframe['offset'] = time / this.duration;
        finalKeyframes.push(finalKeyframe);
      });
    }

    return createTimelineInstruction(finalKeyframes, this.duration, this.startTime, this.easing);
  }
}

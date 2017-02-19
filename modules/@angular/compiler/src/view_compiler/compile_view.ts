/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AnimationEntryCompileResult} from '../animation/animation_compiler';
import {CompileDirectiveMetadata, CompilePipeSummary, rendererTypeName, tokenName, viewClassName} from '../compile_metadata';
import {EventHandlerVars, LegacyNameResolver} from '../compiler_util/expression_converter';
import {CompilerConfig} from '../config';
import {isPresent} from '../facade/lang';
import * as o from '../output/output_ast';
import {ViewType} from '../private_import_core';

import {CompileElement, CompileNode} from './compile_element';
import {CompileMethod} from './compile_method';
import {CompilePipe} from './compile_pipe';
import {CompileQuery, addQueryToTokenMap, createQueryList} from './compile_query';
import {ComponentFactoryDependency, ComponentViewDependency, DirectiveWrapperDependency} from './deps';
import {getPropertyInView} from './util';

export enum CompileViewRootNodeType {
  Node,
  ViewContainer,
  NgContent
}

export class CompileViewRootNode {
  constructor(
      public type: CompileViewRootNodeType, public expr: o.Expression,
      public ngContentIndex?: number) {}
}

export class CompileView implements LegacyNameResolver {
  public viewType: ViewType;
  public viewQueries: Map<any, CompileQuery[]>;

  public viewChildren: o.Expression[] = [];

  public nodes: CompileNode[] = [];

  public rootNodes: CompileViewRootNode[] = [];
  public lastRenderNode: o.Expression = o.NULL_EXPR;

  public viewContainers: o.Expression[] = [];

  public createMethod: CompileMethod;
  public animationBindingsMethod: CompileMethod;
  public injectorGetMethod: CompileMethod;
  public updateContentQueriesMethod: CompileMethod;
  public dirtyParentQueriesMethod: CompileMethod;
  public updateViewQueriesMethod: CompileMethod;
  public detectChangesInInputsMethod: CompileMethod;
  public detectChangesRenderPropertiesMethod: CompileMethod;
  public afterContentLifecycleCallbacksMethod: CompileMethod;
  public afterViewLifecycleCallbacksMethod: CompileMethod;
  public destroyMethod: CompileMethod;
  public detachMethod: CompileMethod;
  public methods: o.ClassMethod[] = [];

  public ctorStmts: o.Statement[] = [];
  public fields: o.ClassField[] = [];
  public getters: o.ClassGetter[] = [];
  public disposables: o.Expression[] = [];

  public componentView: CompileView;
  public purePipes = new Map<string, CompilePipe>();
  public pipes: CompilePipe[] = [];
  public locals = new Map<string, o.Expression>();
  public className: string;
  public rendererTypeName: string;
  public classType: o.Type;
  public classExpr: o.ReadVarExpr;

  public literalArrayCount = 0;
  public literalMapCount = 0;
  public pipeCount = 0;

  public componentContext: o.Expression;

  constructor(
      public component: CompileDirectiveMetadata, public genConfig: CompilerConfig,
      public pipeMetas: CompilePipeSummary[], public styles: o.Expression,
      public animations: AnimationEntryCompileResult[], public viewIndex: number,
      public declarationElement: CompileElement, public templateVariableBindings: string[][],
      public targetDependencies:
          Array<ComponentViewDependency|ComponentFactoryDependency|DirectiveWrapperDependency>) {
    this.createMethod = new CompileMethod(this);
    this.animationBindingsMethod = new CompileMethod(this);
    this.injectorGetMethod = new CompileMethod(this);
    this.updateContentQueriesMethod = new CompileMethod(this);
    this.dirtyParentQueriesMethod = new CompileMethod(this);
    this.updateViewQueriesMethod = new CompileMethod(this);
    this.detectChangesInInputsMethod = new CompileMethod(this);
    this.detectChangesRenderPropertiesMethod = new CompileMethod(this);

    this.afterContentLifecycleCallbacksMethod = new CompileMethod(this);
    this.afterViewLifecycleCallbacksMethod = new CompileMethod(this);
    this.destroyMethod = new CompileMethod(this);
    this.detachMethod = new CompileMethod(this);

    this.viewType = getViewType(component, viewIndex);
    this.className = viewClassName(component.type.reference, viewIndex);
    this.rendererTypeName = rendererTypeName(component.type.reference);
    this.classType = o.expressionType(o.variable(this.className));
    this.classExpr = o.variable(this.className);
    if (this.viewType === ViewType.COMPONENT || this.viewType === ViewType.HOST) {
      this.componentView = this;
    } else {
      this.componentView = this.declarationElement.view.componentView;
    }
    this.componentContext =
        getPropertyInView(o.THIS_EXPR.prop('context'), this, this.componentView);

    const viewQueries = new Map<any, CompileQuery[]>();
    if (this.viewType === ViewType.COMPONENT) {
      const directiveInstance = o.THIS_EXPR.prop('context');
      this.component.viewQueries.forEach((queryMeta, queryIndex) => {
        const propName = `_viewQuery_${tokenName(queryMeta.selectors[0])}_${queryIndex}`;
        const queryList = createQueryList(propName, this);
        const query = new CompileQuery(queryMeta, queryList, directiveInstance, this);
        addQueryToTokenMap(viewQueries, query);
      });
    }
    this.viewQueries = viewQueries;
    templateVariableBindings.forEach(
        (entry) => { this.locals.set(entry[1], o.THIS_EXPR.prop('context').prop(entry[0])); });

    if (!this.declarationElement.isNull()) {
      this.declarationElement.setEmbeddedView(this);
    }
  }

  callPipe(name: string, input: o.Expression, args: o.Expression[]): o.Expression {
    return CompilePipe.call(this, name, [input].concat(args));
  }

  getLocal(name: string): o.Expression {
    if (name == EventHandlerVars.event.name) {
      return EventHandlerVars.event;
    }
    let currView: CompileView = this;
    let result = currView.locals.get(name);
    while (!result && isPresent(currView.declarationElement.view)) {
      currView = currView.declarationElement.view;
      result = currView.locals.get(name);
    }
    if (isPresent(result)) {
      return getPropertyInView(result, this, currView);
    } else {
      return null;
    }
  }

  finish() {
    Array.from(this.viewQueries.values())
        .forEach(
            queries => queries.forEach(
                q => q.generateStatements(this.createMethod, this.updateViewQueriesMethod)));
  }
}

function getViewType(component: CompileDirectiveMetadata, embeddedTemplateIndex: number): ViewType {
  if (embeddedTemplateIndex > 0) {
    return ViewType.EMBEDDED;
  }

  if (component.isHost) {
    return ViewType.HOST;
  }

  return ViewType.COMPONENT;
}

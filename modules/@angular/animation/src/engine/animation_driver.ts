/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AnimationPlayer} from '@angular/core';
import {StyleData} from '../common/style_data';
import {NoOpAnimationPlayer} from '../private_import_core';

/**
 * @experimental
 */
export class NoOpAnimationDriver implements AnimationDriver {
  animate(
      element: any, keyframes: StyleData[], duration: number, delay: number, easing: string,
      previousPlayers: AnimationPlayer[] = []): AnimationPlayer {
    return new NoOpAnimationPlayer();
  }
}

/**
 * @experimental
 */
export abstract class AnimationDriver {
  static NOOP: AnimationDriver = new NoOpAnimationDriver();
  abstract animate(
      element: any, keyframes: StyleData[], duration: number, delay: number, easing: string,
      previousPlayers?: AnimationPlayer[]): AnimationPlayer;
}

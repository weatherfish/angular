/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */


import {Route, UrlMatchResult} from './config';
import {UrlSegment, UrlSegmentGroup} from './url_tree';


/**
 * @whatItDoes Name of the primary outlet.
 *
 * @stable
 */
export const PRIMARY_OUTLET = 'primary';

/**
 * A collection of parameters.
 *
 * @stable
 */
export type Params = {
  [key: string]: any
};

const NAVIGATION_CANCELING_ERROR = 'ngNavigationCancelingError';

export function navigationCancelingError(message: string) {
  const error = Error('NavigationCancelingError: ' + message);
  (error as any)[NAVIGATION_CANCELING_ERROR] = true;
  return error;
}

export function isNavigationCancelingError(error: Error) {
  return (error as any)[NAVIGATION_CANCELING_ERROR];
}

export function defaultUrlMatcher(
    segments: UrlSegment[], segmentGroup: UrlSegmentGroup, route: Route): UrlMatchResult {
  const path = route.path;
  const parts = path.split('/');
  const posParams: {[key: string]: UrlSegment} = {};
  const consumed: UrlSegment[] = [];

  let currentIndex = 0;

  for (let i = 0; i < parts.length; ++i) {
    if (currentIndex >= segments.length) return null;
    const current = segments[currentIndex];

    const p = parts[i];
    const isPosParam = p.startsWith(':');

    if (!isPosParam && p !== current.path) return null;
    if (isPosParam) {
      posParams[p.substring(1)] = current;
    }
    consumed.push(current);
    currentIndex++;
  }

  if (route.pathMatch === 'full' &&
      (segmentGroup.hasChildren() || currentIndex < segments.length)) {
    return null;
  } else {
    return {consumed, posParams};
  }
}

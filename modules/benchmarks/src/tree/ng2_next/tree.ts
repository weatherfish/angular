/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NgIf} from '@angular/common';
import {Component, ComponentFactory, ComponentRef, Injector, NgModule, RootRenderer, Sanitizer, TemplateRef, ViewContainerRef, ViewEncapsulation} from '@angular/core';
import {ArgumentType, BindingType, NodeFlags, ViewData, ViewDefinition, ViewFlags, anchorDef, createComponentFactory, directiveDef, elementDef, initServicesIfNeeded, textDef, viewDef} from '@angular/core/src/view/index';
import {DomSanitizerImpl, SafeStyle} from '@angular/platform-browser/src/security/dom_sanitization_service';

import {TreeNode, emptyTree} from '../util';

let trustedEmptyColor: SafeStyle;
let trustedGreyColor: SafeStyle;

export class TreeComponent {
  data: TreeNode = emptyTree;
  get bgColor() { return this.data.depth % 2 ? trustedEmptyColor : trustedGreyColor; }
}

let viewFlags = ViewFlags.None;

function TreeComponent_Host(): ViewDefinition {
  return viewDef(viewFlags, [
    elementDef(NodeFlags.None, null, null, 1, 'tree'),
    directiveDef(NodeFlags.None, null, 0, TreeComponent, [], null, null, TreeComponent_0),
  ]);
}

function TreeComponent_0(): ViewDefinition {
  const TreeComponent_1: ViewDefinition = viewDef(
      viewFlags,
      [
        elementDef(NodeFlags.None, null, null, 1, 'tree'),
        directiveDef(
            NodeFlags.None, null, 0, TreeComponent, [], {data: [0, 'data']}, null, TreeComponent_0),
      ],
      (check, view) => {
        const cmp = view.component;
        check(view, 1, ArgumentType.Inline, cmp.data.left);
      });

  const TreeComponent_2: ViewDefinition = viewDef(
      viewFlags,
      [
        elementDef(NodeFlags.None, null, null, 1, 'tree'),
        directiveDef(
            NodeFlags.None, null, 0, TreeComponent, [], {data: [0, 'data']}, null, TreeComponent_0),
      ],
      (check, view) => {
        const cmp = view.component;
        check(view, 1, ArgumentType.Inline, cmp.data.left);
      });

  return viewDef(
      viewFlags,
      [
        elementDef(
            NodeFlags.None, null, null, 1, 'span', null,
            [[BindingType.ElementStyle, 'backgroundColor', null]]),
        textDef(null, [' ', ' ']),
        anchorDef(NodeFlags.HasEmbeddedViews, null, null, 1, TreeComponent_1),
        directiveDef(
            NodeFlags.None, null, 0, NgIf, [ViewContainerRef, TemplateRef], {ngIf: [0, 'ngIf']}),
        anchorDef(NodeFlags.HasEmbeddedViews, null, null, 1, TreeComponent_2),
        directiveDef(
            NodeFlags.None, null, 0, NgIf, [ViewContainerRef, TemplateRef], {ngIf: [0, 'ngIf']}),
      ],
      (check, view) => {
        const cmp = view.component;
        check(view, 0, ArgumentType.Inline, cmp.bgColor);
        check(view, 1, ArgumentType.Inline, cmp.data.value);
        check(view, 3, ArgumentType.Inline, cmp.data.left != null);
        check(view, 5, ArgumentType.Inline, cmp.data.right != null);
      });
}

export class AppModule implements Injector {
  private sanitizer: DomSanitizerImpl;
  private componentFactory: ComponentFactory<TreeComponent>;
  componentRef: ComponentRef<TreeComponent>;

  constructor() {
    initServicesIfNeeded();
    this.sanitizer = new DomSanitizerImpl();
    trustedEmptyColor = this.sanitizer.bypassSecurityTrustStyle('');
    trustedGreyColor = this.sanitizer.bypassSecurityTrustStyle('grey');
    this.componentFactory = createComponentFactory('#root', TreeComponent, TreeComponent_Host);
  }

  get(token: any, notFoundValue: any = Injector.THROW_IF_NOT_FOUND): any {
    switch (token) {
      case Sanitizer:
        return this.sanitizer;
      case RootRenderer:
        return null;
    }
    return Injector.NULL.get(token, notFoundValue);
  }

  bootstrap() {
    this.componentRef = this.componentFactory.create(this, [], this.componentFactory.selector);
  }
  tick() { this.componentRef.changeDetectorRef.detectChanges(); }
}

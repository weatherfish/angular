/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NgIf} from '@angular/common';
import {ComponentFactory, ComponentRef, Injector, RendererFactoryV2, RootRenderer, Sanitizer, TemplateRef, ViewContainerRef} from '@angular/core';
import {ArgumentType, BindingType, NodeFlags, ViewDefinition, ViewFlags, anchorDef, createComponentFactory, directiveDef, elementDef, initServicesIfNeeded, textDef, viewDef} from '@angular/core/src/view/index';
import {DomRendererFactoryV2} from '@angular/platform-browser/src/dom/dom_renderer';
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
    elementDef(NodeFlags.None, null, null, 1, 'tree', null, null, null, null, TreeComponent_0),
    directiveDef(NodeFlags.Component, null, 0, TreeComponent, []),
  ]);
}

function TreeComponent_1() {
  return viewDef(
      viewFlags,
      [
        elementDef(NodeFlags.None, null, null, 1, 'tree', null, null, null, null, TreeComponent_0),
        directiveDef(NodeFlags.Component, null, 0, TreeComponent, [], {data: [0, 'data']}),
      ],
      (check, view) => {
        const cmp = view.component;
        check(view, 1, ArgumentType.Inline, cmp.data.left);
      });
}

function TreeComponent_2() {
  return viewDef(
      viewFlags,
      [
        elementDef(NodeFlags.None, null, null, 1, 'tree', null, null, null, null, TreeComponent_0),
        directiveDef(NodeFlags.Component, null, 0, TreeComponent, [], {data: [0, 'data']}),
      ],
      (check, view) => {
        const cmp = view.component;
        check(view, 1, ArgumentType.Inline, cmp.data.left);
      });
}

function TreeComponent_0(): ViewDefinition {
  return viewDef(
      viewFlags,
      [
        elementDef(
            NodeFlags.None, null, null, 1, 'span', null,
            [[BindingType.ElementStyle, 'backgroundColor', null]]),
        textDef(null, [' ', ' ']),
        anchorDef(NodeFlags.EmbeddedViews, null, null, 1, null, TreeComponent_1),
        directiveDef(
            NodeFlags.None, null, 0, NgIf, [ViewContainerRef, TemplateRef], {ngIf: [0, 'ngIf']}),
        anchorDef(NodeFlags.EmbeddedViews, null, null, 1, null, TreeComponent_2),
        directiveDef(
            NodeFlags.None, null, 0, NgIf, [ViewContainerRef, TemplateRef], {ngIf: [0, 'ngIf']}),
      ],
      (check, view) => {
        const cmp = view.component;
        check(view, 3, ArgumentType.Inline, cmp.data.left != null);
        check(view, 5, ArgumentType.Inline, cmp.data.right != null);
      },
      (check, view) => {
        const cmp = view.component;
        check(view, 0, ArgumentType.Inline, cmp.bgColor);
        check(view, 1, ArgumentType.Inline, cmp.data.value);
      });
}

export class AppModule implements Injector {
  private sanitizer: DomSanitizerImpl;
  private componentFactory: ComponentFactory<TreeComponent>;
  private rendererV2: RendererFactoryV2;

  componentRef: ComponentRef<TreeComponent>;

  constructor() {
    initServicesIfNeeded();
    this.sanitizer = new DomSanitizerImpl(document);
    this.rendererV2 = new DomRendererFactoryV2(null, null);
    trustedEmptyColor = this.sanitizer.bypassSecurityTrustStyle('');
    trustedGreyColor = this.sanitizer.bypassSecurityTrustStyle('grey');
    this.componentFactory = createComponentFactory('#root', TreeComponent, TreeComponent_Host);
  }

  get(token: any, notFoundValue: any = Injector.THROW_IF_NOT_FOUND): any {
    switch (token) {
      case RendererFactoryV2:
        return this.rendererV2;
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

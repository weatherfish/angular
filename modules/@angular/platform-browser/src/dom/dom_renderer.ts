/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {APP_ID, Inject, Injectable, RenderComponentType, Renderer, RendererFactoryV2, RendererTypeV2, RendererV2, RootRenderer, ViewEncapsulation} from '@angular/core';

import {isPresent, stringify} from '../facade/lang';
import {AnimationKeyframe, AnimationPlayer, AnimationStyles, DirectRenderer, NoOpAnimationPlayer, RenderDebugInfo} from '../private_import_core';

import {AnimationDriver} from './animation_driver';
import {DOCUMENT} from './dom_tokens';
import {EventManager} from './events/event_manager';
import {DomSharedStylesHost} from './shared_styles_host';

export const NAMESPACE_URIS: {[ns: string]: string} = {
  'xlink': 'http://www.w3.org/1999/xlink',
  'svg': 'http://www.w3.org/2000/svg',
  'xhtml': 'http://www.w3.org/1999/xhtml'
};
const TEMPLATE_COMMENT_TEXT = 'template bindings={}';
const TEMPLATE_BINDINGS_EXP = /^template bindings=(.*)$/;

export abstract class DomRootRenderer implements RootRenderer {
  protected registeredComponents: Map<string, DomRenderer> = new Map<string, DomRenderer>();

  constructor(
      public document: Document, public eventManager: EventManager,
      public sharedStylesHost: DomSharedStylesHost, public animationDriver: AnimationDriver,
      public appId: string) {}

  renderComponent(componentProto: RenderComponentType): Renderer {
    let renderer = this.registeredComponents.get(componentProto.id);
    if (!renderer) {
      renderer = new DomRenderer(
          this, componentProto, this.animationDriver, `${this.appId}-${componentProto.id}`);
      this.registeredComponents.set(componentProto.id, renderer);
    }
    return renderer;
  }
}

@Injectable()
export class DomRootRenderer_ extends DomRootRenderer {
  constructor(
      @Inject(DOCUMENT) _document: any, _eventManager: EventManager,
      sharedStylesHost: DomSharedStylesHost, animationDriver: AnimationDriver,
      @Inject(APP_ID) appId: string) {
    super(_document, _eventManager, sharedStylesHost, animationDriver, appId);
  }
}

export const DIRECT_DOM_RENDERER: DirectRenderer = {
  remove(node: Text | Comment | Element) {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
  },
  appendChild(node: Node, parent: Element) { parent.appendChild(node);},
  insertBefore(node: Node, refNode: Node) { refNode.parentNode.insertBefore(node, refNode);},
  nextSibling(node: Node) { return node.nextSibling;},
  parentElement(node: Node): Element{return node.parentNode as Element;}
};

export class DomRenderer implements Renderer {
  private _contentAttr: string;
  private _hostAttr: string;
  private _styles: string[];

  directRenderer: DirectRenderer = DIRECT_DOM_RENDERER;

  constructor(
      private _rootRenderer: DomRootRenderer, private componentProto: RenderComponentType,
      private _animationDriver: AnimationDriver, styleShimId: string) {
    this._styles = flattenStyles(styleShimId, componentProto.styles, []);
    if (componentProto.encapsulation !== ViewEncapsulation.Native) {
      this._rootRenderer.sharedStylesHost.addStyles(this._styles);
    }
    if (this.componentProto.encapsulation === ViewEncapsulation.Emulated) {
      this._contentAttr = shimContentAttribute(styleShimId);
      this._hostAttr = shimHostAttribute(styleShimId);
    } else {
      this._contentAttr = null;
      this._hostAttr = null;
    }
  }

  selectRootElement(selectorOrNode: string|Element, debugInfo: RenderDebugInfo): Element {
    let el: Element;
    if (typeof selectorOrNode === 'string') {
      el = this._rootRenderer.document.querySelector(selectorOrNode);
      if (!el) {
        throw new Error(`The selector "${selectorOrNode}" did not match any elements`);
      }
    } else {
      el = selectorOrNode;
    }
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    return el;
  }

  createElement(parent: Element|DocumentFragment, name: string, debugInfo: RenderDebugInfo):
      Element {
    let el: Element;
    if (isNamespaced(name)) {
      const nsAndName = splitNamespace(name);
      el = document.createElementNS((NAMESPACE_URIS)[nsAndName[0]], nsAndName[1]);
    } else {
      el = document.createElement(name);
    }
    if (this._contentAttr) {
      el.setAttribute(this._contentAttr, '');
    }
    if (parent) {
      parent.appendChild(el);
    }
    return el;
  }

  createViewRoot(hostElement: Element): Element|DocumentFragment {
    let nodesParent: Element|DocumentFragment;
    if (this.componentProto.encapsulation === ViewEncapsulation.Native) {
      nodesParent = (hostElement as any).createShadowRoot();
      this._rootRenderer.sharedStylesHost.addHost(nodesParent);
      for (let i = 0; i < this._styles.length; i++) {
        const styleEl = document.createElement('style');
        styleEl.textContent = this._styles[i];
        nodesParent.appendChild(styleEl);
      }
    } else {
      if (this._hostAttr) {
        hostElement.setAttribute(this._hostAttr, '');
      }
      nodesParent = hostElement;
    }
    return nodesParent;
  }

  createTemplateAnchor(parentElement: Element|DocumentFragment, debugInfo: RenderDebugInfo):
      Comment {
    const comment = document.createComment(TEMPLATE_COMMENT_TEXT);
    if (parentElement) {
      parentElement.appendChild(comment);
    }
    return comment;
  }

  createText(parentElement: Element|DocumentFragment, value: string, debugInfo: RenderDebugInfo):
      any {
    const node = document.createTextNode(value);
    if (parentElement) {
      parentElement.appendChild(node);
    }
    return node;
  }

  projectNodes(parentElement: Element|DocumentFragment, nodes: Node[]) {
    if (!parentElement) return;
    appendNodes(parentElement, nodes);
  }

  attachViewAfter(node: Node, viewRootNodes: Node[]) { moveNodesAfterSibling(node, viewRootNodes); }

  detachView(viewRootNodes: (Element|Text|Comment)[]) {
    for (let i = 0; i < viewRootNodes.length; i++) {
      const node = viewRootNodes[i];
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
  }

  destroyView(hostElement: Element|DocumentFragment, viewAllNodes: Node[]) {
    if (this.componentProto.encapsulation === ViewEncapsulation.Native && hostElement) {
      this._rootRenderer.sharedStylesHost.removeHost((hostElement as any).shadowRoot);
    }
  }

  listen(renderElement: any, name: string, callback: Function): Function {
    return this._rootRenderer.eventManager.addEventListener(
        renderElement, name, decoratePreventDefault(callback));
  }

  listenGlobal(target: string, name: string, callback: Function): Function {
    return this._rootRenderer.eventManager.addGlobalEventListener(
        target, name, decoratePreventDefault(callback));
  }

  setElementProperty(
      renderElement: Element|DocumentFragment, propertyName: string, propertyValue: any): void {
    (renderElement as any)[propertyName] = propertyValue;
  }

  setElementAttribute(renderElement: Element, attributeName: string, attributeValue: string): void {
    let attrNs: string;
    let attrNameWithoutNs = attributeName;
    if (isNamespaced(attributeName)) {
      const nsAndName = splitNamespace(attributeName);
      attrNameWithoutNs = nsAndName[1];
      attributeName = nsAndName[0] + ':' + nsAndName[1];
      attrNs = NAMESPACE_URIS[nsAndName[0]];
    }
    if (isPresent(attributeValue)) {
      if (attrNs) {
        renderElement.setAttributeNS(attrNs, attributeName, attributeValue);
      } else {
        renderElement.setAttribute(attributeName, attributeValue);
      }
    } else {
      if (isPresent(attrNs)) {
        renderElement.removeAttributeNS(attrNs, attrNameWithoutNs);
      } else {
        renderElement.removeAttribute(attributeName);
      }
    }
  }

  setBindingDebugInfo(renderElement: Element, propertyName: string, propertyValue: string): void {
    if (renderElement.nodeType === Node.COMMENT_NODE) {
      const existingBindings =
          renderElement.nodeValue.replace(/\n/g, '').match(TEMPLATE_BINDINGS_EXP);
      const parsedBindings = JSON.parse(existingBindings[1]);
      parsedBindings[propertyName] = propertyValue;
      renderElement.nodeValue =
          TEMPLATE_COMMENT_TEXT.replace('{}', JSON.stringify(parsedBindings, null, 2));
    } else {
      // Attribute names with `$` (eg `x-y$`) are valid per spec, but unsupported by some browsers
      propertyName = propertyName.replace(/\$/g, '_');
      this.setElementAttribute(renderElement, propertyName, propertyValue);
    }
  }

  setElementClass(renderElement: Element, className: string, isAdd: boolean): void {
    if (isAdd) {
      renderElement.classList.add(className);
    } else {
      renderElement.classList.remove(className);
    }
  }

  setElementStyle(renderElement: HTMLElement, styleName: string, styleValue: string): void {
    if (isPresent(styleValue)) {
      (renderElement.style as any)[styleName] = stringify(styleValue);
    } else {
      // IE requires '' instead of null
      // see https://github.com/angular/angular/issues/7916
      (renderElement.style as any)[styleName] = '';
    }
  }

  invokeElementMethod(renderElement: Element, methodName: string, args: any[]): void {
    (renderElement as any)[methodName].apply(renderElement, args);
  }

  setText(renderNode: Text, text: string): void { renderNode.nodeValue = text; }

  animate(
      element: any, startingStyles: AnimationStyles, keyframes: AnimationKeyframe[],
      duration: number, delay: number, easing: string,
      previousPlayers: AnimationPlayer[] = []): AnimationPlayer {
    if (this._rootRenderer.document.body.contains(element)) {
      return this._animationDriver.animate(
          element, startingStyles, keyframes, duration, delay, easing, previousPlayers);
    }
    return new NoOpAnimationPlayer();
  }
}

function moveNodesAfterSibling(sibling: Node, nodes: Node[]) {
  const parent = sibling.parentNode;
  if (nodes.length > 0 && parent) {
    const nextSibling = sibling.nextSibling;
    if (nextSibling) {
      for (let i = 0; i < nodes.length; i++) {
        parent.insertBefore(nodes[i], nextSibling);
      }
    } else {
      for (let i = 0; i < nodes.length; i++) {
        parent.appendChild(nodes[i]);
      }
    }
  }
}

function appendNodes(parent: Element | DocumentFragment, nodes: Node[]) {
  for (let i = 0; i < nodes.length; i++) {
    parent.appendChild(nodes[i]);
  }
}

function decoratePreventDefault(eventHandler: Function): Function {
  return (event: any) => {
    const allowDefaultBehavior = eventHandler(event);
    if (allowDefaultBehavior === false) {
      // TODO(tbosch): move preventDefault into event plugins...
      event.preventDefault();
      event.returnValue = false;
    }
  };
}

const COMPONENT_REGEX = /%COMP%/g;
export const COMPONENT_VARIABLE = '%COMP%';
export const HOST_ATTR = `_nghost-${COMPONENT_VARIABLE}`;
export const CONTENT_ATTR = `_ngcontent-${COMPONENT_VARIABLE}`;

export function shimContentAttribute(componentShortId: string): string {
  return CONTENT_ATTR.replace(COMPONENT_REGEX, componentShortId);
}

export function shimHostAttribute(componentShortId: string): string {
  return HOST_ATTR.replace(COMPONENT_REGEX, componentShortId);
}

export function flattenStyles(
    compId: string, styles: Array<any|any[]>, target: string[]): string[] {
  for (let i = 0; i < styles.length; i++) {
    let style = styles[i];

    if (Array.isArray(style)) {
      flattenStyles(compId, style, target);
    } else {
      style = style.replace(COMPONENT_REGEX, compId);
      target.push(style);
    }
  }
  return target;
}

const NS_PREFIX_RE = /^:([^:]+):(.+)$/;

export function isNamespaced(name: string) {
  return name[0] === ':';
}

export function splitNamespace(name: string): string[] {
  const match = name.match(NS_PREFIX_RE);
  return [match[1], match[2]];
}


let attrCache: Map<string, Attr>;

function createAttributeNode(name: string): Attr {
  if (!attrCache) {
    attrCache = new Map<string, Attr>();
  }
  if (attrCache.has(name)) {
    return attrCache.get(name);
  }

  const div = document.createElement('div');
  div.innerHTML = `<div ${name}>`;
  const attr: Attr = div.firstChild.attributes[0];
  attrCache.set(name, attr);
  return attr;
}

@Injectable()
export class DomRendererFactoryV2 implements RendererFactoryV2 {
  private rendererByCompId = new Map<string, RendererV2>();
  private defaultRenderer: RendererV2;

  constructor(private eventManager: EventManager, private sharedStylesHost: DomSharedStylesHost) {
    this.defaultRenderer = new DefaultDomRendererV2(eventManager);
  };

  createRenderer(element: any, type: RendererTypeV2): RendererV2 {
    if (!element || !type) {
      return this.defaultRenderer;
    }
    switch (type.encapsulation) {
      case ViewEncapsulation.Emulated: {
        let renderer = this.rendererByCompId.get(type.id);
        if (!renderer) {
          renderer = new EmulatedEncapsulationDomRendererV2(
              this.eventManager, this.sharedStylesHost, type);
          this.rendererByCompId.set(type.id, renderer);
        }
        (<EmulatedEncapsulationDomRendererV2>renderer).applyToHost(element);
        return renderer;
      }
      case ViewEncapsulation.Native:
        return new ShadowDomRenderer(this.eventManager, this.sharedStylesHost, element, type);
      default: {
        if (!this.rendererByCompId.has(type.id)) {
          const styles = flattenStyles(type.id, type.styles, []);
          this.sharedStylesHost.addStyles(styles);
          this.rendererByCompId.set(type.id, this.defaultRenderer);
        }
        return this.defaultRenderer;
      }
    }
  }
}

class DefaultDomRendererV2 implements RendererV2 {
  constructor(private eventManager: EventManager) {}

  destroy(): void {}

  destroyNode: null;

  createElement(name: string, namespace?: string): any {
    if (namespace) {
      return document.createElementNS(NAMESPACE_URIS[namespace], name);
    }

    return document.createElement(name);
  }

  createComment(value: string): any { return document.createComment(value); }

  createText(value: string): any { return document.createTextNode(value); }

  appendChild(parent: any, newChild: any): void { parent.appendChild(newChild); }

  insertBefore(parent: any, newChild: any, refChild: any): void {
    if (parent) {
      parent.insertBefore(newChild, refChild);
    }
  }

  removeChild(parent: any, oldChild: any): void {
    if (parent) {
      parent.removeChild(oldChild);
    }
  }

  selectRootElement(selectorOrNode: string|any): any {
    let el: any = typeof selectorOrNode === 'string' ? document.querySelector(selectorOrNode) :
                                                       selectorOrNode;
    if (!el) {
      throw new Error(`The selector "${selectorOrNode}" did not match any elements`);
    }
    el.textContent = '';
    return el;
  }

  parentNode(node: any): any { return node.parentNode; }

  nextSibling(node: any): any { return node.nextSibling; }

  setAttribute(el: any, name: string, value: string, namespace?: string): void {
    if (namespace) {
      el.setAttributeNS(NAMESPACE_URIS[namespace], namespace + ':' + name, value);
    } else {
      el.setAttribute(name, value);
    }
  }

  removeAttribute(el: any, name: string, namespace?: string): void {
    if (namespace) {
      el.removeAttributeNS(NAMESPACE_URIS[namespace], name);
    } else {
      el.removeAttribute(name);
    }
  }

  addClass(el: any, name: string): void { el.classList.add(name); }

  removeClass(el: any, name: string): void { el.classList.remove(name); }

  setStyle(el: any, style: string, value: any, hasVendorPrefix: boolean, hasImportant: boolean):
      void {
    if (hasVendorPrefix || hasImportant) {
      el.style.setProperty(style, value, hasImportant ? 'important' : '');
    } else {
      el.style[style] = value;
    }
  }

  removeStyle(el: any, style: string, hasVendorPrefix: boolean): void {
    if (hasVendorPrefix) {
      el.style.removeProperty(style);
    } else {
      // IE requires '' instead of null
      // see https://github.com/angular/angular/issues/7916
      el.style[style] = '';
    }
  }

  setProperty(el: any, name: string, value: any): void { el[name] = value; }

  setValue(node: any, value: string): void { node.nodeValue = value; }

  listen(target: 'window'|'document'|'body'|any, event: string, callback: (event: any) => boolean):
      () => void {
    if (typeof target === 'string') {
      return <() => void>this.eventManager.addGlobalEventListener(
          target, event, decoratePreventDefault(callback));
    }
    return <() => void>this.eventManager.addEventListener(
               target, event, decoratePreventDefault(callback)) as() => void;
  }
}

class EmulatedEncapsulationDomRendererV2 extends DefaultDomRendererV2 {
  private contentAttr: string;
  private hostAttr: string;

  constructor(
      eventManager: EventManager, sharedStylesHost: DomSharedStylesHost,
      private component: RendererTypeV2) {
    super(eventManager);
    const styles = flattenStyles(component.id, component.styles, []);
    sharedStylesHost.addStyles(styles);

    this.contentAttr = shimContentAttribute(component.id);
    this.hostAttr = shimHostAttribute(component.id);
  }

  applyToHost(element: any) { super.setAttribute(element, this.hostAttr, ''); }

  createElement(parent: any, name: string): Element {
    const el = super.createElement(parent, name);
    super.setAttribute(el, this.contentAttr, '');
    return el;
  }
}

class ShadowDomRenderer extends DefaultDomRendererV2 {
  private shadowRoot: any;

  constructor(
      eventManager: EventManager, private sharedStylesHost: DomSharedStylesHost,
      private hostEl: any, private component: RendererTypeV2) {
    super(eventManager);
    this.shadowRoot = (hostEl as any).createShadowRoot();
    this.sharedStylesHost.addHost(this.shadowRoot);
    const styles = flattenStyles(component.id, component.styles, []);
    for (let i = 0; i < styles.length; i++) {
      const styleEl = document.createElement('style');
      styleEl.textContent = styles[i];
      this.shadowRoot.appendChild(styleEl);
    }
  }

  private nodeOrShadowRoot(node: any): any { return node === this.hostEl ? this.shadowRoot : node; }

  destroy() { this.sharedStylesHost.removeHost(this.shadowRoot); }

  appendChild(parent: any, newChild: any): void {
    return super.appendChild(this.nodeOrShadowRoot(parent), newChild);
  }
  insertBefore(parent: any, newChild: any, refChild: any): void {
    return super.insertBefore(this.nodeOrShadowRoot(parent), newChild, refChild);
  }
  removeChild(parent: any, oldChild: any): void {
    return super.removeChild(this.nodeOrShadowRoot(parent), oldChild);
  }
  parentNode(node: any): any {
    return this.nodeOrShadowRoot(super.parentNode(this.nodeOrShadowRoot(node)));
  }
}
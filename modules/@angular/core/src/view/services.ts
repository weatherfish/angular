/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {isDevMode} from '../application_ref';
import {DebugElement, DebugNode, EventListener, getDebugNode, indexDebugNode, removeDebugNodeFromIndex} from '../debug/debug_node';
import {Injector} from '../di';
import {RendererFactoryV2, RendererTypeV2, RendererV2} from '../render/api';
import {Sanitizer, SecurityContext} from '../security';

import {isViewDebugError, viewDestroyedError, viewWrappedDebugError} from './errors';
import {resolveDep} from './provider';
import {dirtyParentQueries, getQueryValue} from './query';
import {createInjector} from './refs';
import {ArgumentType, BindingType, CheckType, DebugContext, DepFlags, ElementData, NodeCheckFn, NodeData, NodeDef, NodeFlags, RootData, Services, ViewData, ViewDefinition, ViewDefinitionFactory, ViewState, asElementData, asProviderData, asPureExpressionData} from './types';
import {checkBinding, isComponentView, renderNode, viewParentEl} from './util';
import {checkAndUpdateNode, checkAndUpdateView, checkNoChangesNode, checkNoChangesView, createEmbeddedView, createRootView, destroyView} from './view';

let initialized = false;

export function initServicesIfNeeded() {
  if (initialized) {
    return;
  }
  initialized = true;
  const services = isDevMode() ? createDebugServices() : createProdServices();
  Services.setCurrentNode = services.setCurrentNode;
  Services.createRootView = services.createRootView;
  Services.createEmbeddedView = services.createEmbeddedView;
  Services.checkAndUpdateView = services.checkAndUpdateView;
  Services.checkNoChangesView = services.checkNoChangesView;
  Services.destroyView = services.destroyView;
  Services.resolveDep = resolveDep;
  Services.createDebugContext = services.createDebugContext;
  Services.handleEvent = services.handleEvent;
  Services.updateDirectives = services.updateDirectives;
  Services.updateRenderer = services.updateRenderer;
  Services.dirtyParentQueries = dirtyParentQueries;
}

function createProdServices() {
  return {
    setCurrentNode: () => {},
    createRootView: createProdRootView,
    createEmbeddedView: createEmbeddedView,
    checkAndUpdateView: checkAndUpdateView,
    checkNoChangesView: checkNoChangesView,
    destroyView: destroyView,
    createDebugContext: (view: ViewData, nodeIndex: number) => new DebugContext_(view, nodeIndex),
    handleEvent: (view: ViewData, nodeIndex: number, eventName: string, event: any) =>
                     view.def.handleEvent(view, nodeIndex, eventName, event),
    updateDirectives: (view: ViewData, checkType: CheckType) => view.def.updateDirectives(
                          checkType === CheckType.CheckAndUpdate ? prodCheckAndUpdateNode :
                                                                   prodCheckNoChangesNode,
                          view),
    updateRenderer: (view: ViewData, checkType: CheckType) => view.def.updateRenderer(
                        checkType === CheckType.CheckAndUpdate ? prodCheckAndUpdateNode :
                                                                 prodCheckNoChangesNode,
                        view),
  };
}

function createDebugServices() {
  return {
    setCurrentNode: debugSetCurrentNode,
    createRootView: debugCreateRootView,
    createEmbeddedView: debugCreateEmbeddedView,
    checkAndUpdateView: debugCheckAndUpdateView,
    checkNoChangesView: debugCheckNoChangesView,
    destroyView: debugDestroyView,
    createDebugContext: (view: ViewData, nodeIndex: number) => new DebugContext_(view, nodeIndex),
    handleEvent: debugHandleEvent,
    updateDirectives: debugUpdateDirectives,
    updateRenderer: debugUpdateRenderer
  };
}

function createProdRootView(
    injector: Injector, projectableNodes: any[][], rootSelectorOrNode: string | any,
    def: ViewDefinition, context?: any): ViewData {
  const rendererFactory: RendererFactoryV2 = injector.get(RendererFactoryV2);
  return createRootView(
      createRootData(injector, rendererFactory, projectableNodes, rootSelectorOrNode), def,
      context);
}

function debugCreateRootView(
    injector: Injector, projectableNodes: any[][], rootSelectorOrNode: string | any,
    def: ViewDefinition, context?: any): ViewData {
  const rendererFactory: RendererFactoryV2 = injector.get(RendererFactoryV2);
  const root = createRootData(
      injector, new DebugRendererFactoryV2(rendererFactory), projectableNodes, rootSelectorOrNode);
  return callWithDebugContext(DebugAction.create, createRootView, null, [root, def, context]);
}

function createRootData(
    injector: Injector, rendererFactory: RendererFactoryV2, projectableNodes: any[][],
    rootSelectorOrNode: any): RootData {
  const sanitizer = injector.get(Sanitizer);
  const renderer = rendererFactory.createRenderer(null, null);
  return {
    injector,
    projectableNodes,
    selectorOrNode: rootSelectorOrNode, sanitizer, rendererFactory, renderer
  };
}

function prodCheckAndUpdateNode(
    view: ViewData, nodeIndex: number, argStyle: ArgumentType, v0?: any, v1?: any, v2?: any,
    v3?: any, v4?: any, v5?: any, v6?: any, v7?: any, v8?: any, v9?: any): any {
  const nodeDef = view.def.nodes[nodeIndex];
  checkAndUpdateNode(view, nodeDef, argStyle, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9);
  return (nodeDef.flags & NodeFlags.CatPureExpression) ?
      asPureExpressionData(view, nodeIndex).value :
      undefined;
}

function prodCheckNoChangesNode(
    view: ViewData, nodeIndex: number, argStyle: ArgumentType, v0?: any, v1?: any, v2?: any,
    v3?: any, v4?: any, v5?: any, v6?: any, v7?: any, v8?: any, v9?: any): any {
  const nodeDef = view.def.nodes[nodeIndex];
  checkNoChangesNode(view, nodeDef, argStyle, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9);
  return (nodeDef.flags & NodeFlags.CatPureExpression) ?
      asPureExpressionData(view, nodeIndex).value :
      undefined;
}

function debugCreateEmbeddedView(parent: ViewData, anchorDef: NodeDef, context?: any): ViewData {
  return callWithDebugContext(
      DebugAction.create, createEmbeddedView, null, [parent, anchorDef, context]);
}

function debugCheckAndUpdateView(view: ViewData) {
  return callWithDebugContext(DebugAction.detectChanges, checkAndUpdateView, null, [view]);
}

function debugCheckNoChangesView(view: ViewData) {
  return callWithDebugContext(DebugAction.checkNoChanges, checkNoChangesView, null, [view]);
}

function debugDestroyView(view: ViewData) {
  return callWithDebugContext(DebugAction.destroy, destroyView, null, [view]);
}

enum DebugAction {
  create,
  detectChanges,
  checkNoChanges,
  destroy,
  handleEvent
}

let _currentAction: DebugAction;
let _currentView: ViewData;
let _currentNodeIndex: number;

function debugSetCurrentNode(view: ViewData, nodeIndex: number) {
  _currentView = view;
  _currentNodeIndex = nodeIndex;
}

function debugHandleEvent(view: ViewData, nodeIndex: number, eventName: string, event: any) {
  debugSetCurrentNode(view, nodeIndex);
  return callWithDebugContext(
      DebugAction.handleEvent, view.def.handleEvent, null, [view, nodeIndex, eventName, event]);
}

function debugUpdateDirectives(view: ViewData, checkType: CheckType) {
  if (view.state & ViewState.Destroyed) {
    throw viewDestroyedError(DebugAction[_currentAction]);
  }
  debugSetCurrentNode(view, nextDirectiveWithBinding(view, 0));
  return view.def.updateDirectives(debugCheckDirectivesFn, view);

  function debugCheckDirectivesFn(
      view: ViewData, nodeIndex: number, argStyle: ArgumentType, ...values: any[]) {
    const nodeDef = view.def.nodes[nodeIndex];
    if (checkType === CheckType.CheckAndUpdate) {
      debugCheckAndUpdateNode(view, nodeDef, argStyle, values);
    } else {
      debugCheckNoChangesNode(view, nodeDef, argStyle, values);
    }
    if (nodeDef.flags & NodeFlags.TypeDirective) {
      debugSetCurrentNode(view, nextDirectiveWithBinding(view, nodeIndex));
    }
    return (nodeDef.flags & NodeFlags.CatPureExpression) ?
        asPureExpressionData(view, nodeDef.index).value :
        undefined;
  };
}

function debugUpdateRenderer(view: ViewData, checkType: CheckType) {
  if (view.state & ViewState.Destroyed) {
    throw viewDestroyedError(DebugAction[_currentAction]);
  }
  debugSetCurrentNode(view, nextRenderNodeWithBinding(view, 0));
  return view.def.updateRenderer(debugCheckRenderNodeFn, view);

  function debugCheckRenderNodeFn(
      view: ViewData, nodeIndex: number, argStyle: ArgumentType, ...values: any[]) {
    const nodeDef = view.def.nodes[nodeIndex];
    if (checkType === CheckType.CheckAndUpdate) {
      debugCheckAndUpdateNode(view, nodeDef, argStyle, values);
    } else {
      debugCheckNoChangesNode(view, nodeDef, argStyle, values);
    }
    if (nodeDef.flags & NodeFlags.CatRenderNode) {
      debugSetCurrentNode(view, nextRenderNodeWithBinding(view, nodeIndex));
    }
    return (nodeDef.flags & NodeFlags.CatPureExpression) ?
        asPureExpressionData(view, nodeDef.index).value :
        undefined;
  }
}

function debugCheckAndUpdateNode(
    view: ViewData, nodeDef: NodeDef, argStyle: ArgumentType, givenValues: any[]): void {
  const changed = (<any>checkAndUpdateNode)(view, nodeDef, argStyle, ...givenValues);
  if (changed) {
    const values = argStyle === ArgumentType.Dynamic ? givenValues[0] : givenValues;
    if (nodeDef.flags & (NodeFlags.TypeDirective | NodeFlags.TypeElement)) {
      const bindingValues: {[key: string]: string} = {};
      for (let i = 0; i < nodeDef.bindings.length; i++) {
        const binding = nodeDef.bindings[i];
        const value = values[i];
        if ((binding.type === BindingType.ComponentHostProperty ||
             binding.type === BindingType.DirectiveProperty)) {
          bindingValues[normalizeDebugBindingName(binding.nonMinifiedName)] =
              normalizeDebugBindingValue(value);
        }
      }
      const elDef = nodeDef.flags & NodeFlags.TypeDirective ? nodeDef.parent : nodeDef;
      const el = asElementData(view, elDef.index).renderElement;
      if (!elDef.element.name) {
        // a comment.
        view.renderer.setValue(el, `bindings=${JSON.stringify(bindingValues, null, 2)}`);
      } else {
        // a regular element.
        for (let attr in bindingValues) {
          const value = bindingValues[attr];
          if (value != null) {
            view.renderer.setAttribute(el, attr, value);
          } else {
            view.renderer.removeAttribute(el, attr);
          }
        }
      }
    }
  }
}

function debugCheckNoChangesNode(
    view: ViewData, nodeDef: NodeDef, argStyle: ArgumentType, values: any[]): void {
  (<any>checkNoChangesNode)(view, nodeDef, argStyle, ...values);
}

function normalizeDebugBindingName(name: string) {
  // Attribute names with `$` (eg `x-y$`) are valid per spec, but unsupported by some browsers
  name = camelCaseToDashCase(name.replace(/[$@]/g, '_'));
  return `ng-reflect-${name}`;
}

const CAMEL_CASE_REGEXP = /([A-Z])/g;

function camelCaseToDashCase(input: string): string {
  return input.replace(CAMEL_CASE_REGEXP, (...m: any[]) => '-' + m[1].toLowerCase());
}

function normalizeDebugBindingValue(value: any): string {
  try {
    // Limit the size of the value as otherwise the DOM just gets polluted.
    return value ? value.toString().slice(0, 30) : value;
  } catch (e) {
    return '[ERROR] Exception while trying to serialize the value';
  }
}

function nextDirectiveWithBinding(view: ViewData, nodeIndex: number): number {
  for (let i = nodeIndex; i < view.def.nodes.length; i++) {
    const nodeDef = view.def.nodes[i];
    if (nodeDef.flags & NodeFlags.TypeDirective && nodeDef.bindings && nodeDef.bindings.length) {
      return i;
    }
  }
  return undefined;
}

function nextRenderNodeWithBinding(view: ViewData, nodeIndex: number): number {
  for (let i = nodeIndex; i < view.def.nodes.length; i++) {
    const nodeDef = view.def.nodes[i];
    if ((nodeDef.flags & NodeFlags.CatRenderNode) && nodeDef.bindings && nodeDef.bindings.length) {
      return i;
    }
  }
  return undefined;
}

class DebugContext_ implements DebugContext {
  private nodeDef: NodeDef;
  private elView: ViewData;
  private elDef: NodeDef;
  constructor(public view: ViewData, public nodeIndex: number) {
    if (nodeIndex == null) {
      this.nodeIndex = nodeIndex = 0;
    }
    this.nodeDef = view.def.nodes[nodeIndex];
    let elDef = this.nodeDef;
    let elView = view;
    while (elDef && (elDef.flags & NodeFlags.TypeElement) === 0) {
      elDef = elDef.parent;
    }
    if (!elDef) {
      while (!elDef && elView) {
        elDef = viewParentEl(elView);
        elView = elView.parent;
      }
    }
    this.elDef = elDef;
    this.elView = elView;
  }
  private get elOrCompView() {
    // Has to be done lazily as we use the DebugContext also during creation of elements...
    return asElementData(this.elView, this.elDef.index).componentView || this.view;
  }
  get injector(): Injector { return createInjector(this.elView, this.elDef); }
  get component(): any { return this.elOrCompView.component; }
  get context(): any { return this.elOrCompView.context; }
  get providerTokens(): any[] {
    const tokens: any[] = [];
    if (this.elDef) {
      for (let i = this.elDef.index + 1; i <= this.elDef.index + this.elDef.childCount; i++) {
        const childDef = this.elView.def.nodes[i];
        if (childDef.flags & NodeFlags.CatProvider) {
          tokens.push(childDef.provider.token);
        }
        i += childDef.childCount;
      }
    }
    return tokens;
  }
  get references(): {[key: string]: any} {
    const references: {[key: string]: any} = {};
    if (this.elDef) {
      collectReferences(this.elView, this.elDef, references);

      for (let i = this.elDef.index + 1; i <= this.elDef.index + this.elDef.childCount; i++) {
        const childDef = this.elView.def.nodes[i];
        if (childDef.flags & NodeFlags.CatProvider) {
          collectReferences(this.elView, childDef, references);
        }
        i += childDef.childCount;
      }
    }
    return references;
  }
  get source(): string {
    if (this.nodeDef.flags & NodeFlags.TypeText) {
      return this.nodeDef.text.source;
    } else {
      return this.elDef.element.source;
    }
  }
  get componentRenderElement() {
    const elData = findHostElement(this.elOrCompView);
    return elData ? elData.renderElement : undefined;
  }
  get renderNode(): any {
    return this.nodeDef.flags & NodeFlags.TypeText ? renderNode(this.view, this.nodeDef) :
                                                     renderNode(this.elView, this.elDef);
  }
}

function findHostElement(view: ViewData): ElementData {
  while (view && !isComponentView(view)) {
    view = view.parent;
  }
  if (view.parent) {
    return asElementData(view.parent, viewParentEl(view).index);
  }
  return undefined;
}

function collectReferences(view: ViewData, nodeDef: NodeDef, references: {[key: string]: any}) {
  for (let refName in nodeDef.references) {
    references[refName] = getQueryValue(view, nodeDef, nodeDef.references[refName]);
  }
}

function callWithDebugContext(action: DebugAction, fn: any, self: any, args: any[]) {
  const oldAction = _currentAction;
  const oldView = _currentView;
  const oldNodeIndex = _currentNodeIndex;
  try {
    _currentAction = action;
    const result = fn.apply(self, args);
    _currentView = oldView;
    _currentNodeIndex = oldNodeIndex;
    _currentAction = oldAction;
    return result;
  } catch (e) {
    if (isViewDebugError(e) || !_currentView) {
      throw e;
    }
    _currentView.state |= ViewState.Errored;
    throw viewWrappedDebugError(e, getCurrentDebugContext());
  }
}

export function getCurrentDebugContext(): DebugContext {
  return new DebugContext_(_currentView, _currentNodeIndex);
}


class DebugRendererFactoryV2 implements RendererFactoryV2 {
  constructor(private delegate: RendererFactoryV2) {}

  createRenderer(element: any, renderData: RendererTypeV2): RendererV2 {
    return new DebugRendererV2(this.delegate.createRenderer(element, renderData));
  }
}


class DebugRendererV2 implements RendererV2 {
  constructor(private delegate: RendererV2) {}

  get data() { return this.delegate.data; }

  destroyNode(node: any) {
    removeDebugNodeFromIndex(getDebugNode(node));
    if (this.delegate.destroyNode) {
      this.delegate.destroyNode(node);
    }
  }

  destroy() { this.delegate.destroy(); }

  createElement(name: string, namespace?: string): any {
    const el = this.delegate.createElement(name, namespace);
    const debugEl = new DebugElement(el, null, getCurrentDebugContext());
    debugEl.name = name;
    indexDebugNode(debugEl);
    return el;
  }

  createComment(value: string): any {
    const comment = this.delegate.createComment(value);
    const debugEl = new DebugNode(comment, null, getCurrentDebugContext());
    indexDebugNode(debugEl);
    return comment;
  }

  createText(value: string): any {
    const text = this.delegate.createText(value);
    const debugEl = new DebugNode(text, null, getCurrentDebugContext());
    indexDebugNode(debugEl);
    return text;
  }

  appendChild(parent: any, newChild: any): void {
    const debugEl = getDebugNode(parent);
    const debugChildEl = getDebugNode(newChild);
    if (debugEl && debugChildEl && debugEl instanceof DebugElement) {
      debugEl.addChild(debugChildEl);
    }
    this.delegate.appendChild(parent, newChild);
  }

  insertBefore(parent: any, newChild: any, refChild: any): void {
    const debugEl = getDebugNode(parent);
    const debugChildEl = getDebugNode(newChild);
    const debugRefEl = getDebugNode(refChild);
    if (debugEl && debugChildEl && debugEl instanceof DebugElement) {
      debugEl.insertBefore(debugRefEl, debugChildEl);
    }

    this.delegate.insertBefore(parent, newChild, refChild);
  }

  removeChild(parent: any, oldChild: any): void {
    const debugEl = getDebugNode(parent);
    const debugChildEl = getDebugNode(oldChild);
    if (debugEl && debugChildEl && debugEl instanceof DebugElement) {
      debugEl.removeChild(debugChildEl);
    }
    this.delegate.removeChild(parent, oldChild);
  }

  selectRootElement(selectorOrNode: string|any): any {
    const el = this.delegate.selectRootElement(selectorOrNode);
    const debugEl = new DebugElement(el, null, getCurrentDebugContext());
    indexDebugNode(debugEl);
    return el;
  }

  setAttribute(el: any, name: string, value: string, namespace?: string): void {
    const debugEl = getDebugNode(el);
    if (debugEl && debugEl instanceof DebugElement) {
      const fullName = namespace ? namespace + ':' + name : name;
      debugEl.attributes[fullName] = value;
    }
    this.delegate.setAttribute(el, name, value, namespace);
  }

  removeAttribute(el: any, name: string, namespace?: string): void {
    const debugEl = getDebugNode(el);
    if (debugEl && debugEl instanceof DebugElement) {
      const fullName = namespace ? namespace + ':' + name : name;
      debugEl.attributes[fullName] = null;
    }
    this.delegate.removeAttribute(el, name, namespace);
  }

  addClass(el: any, name: string): void {
    const debugEl = getDebugNode(el);
    if (debugEl && debugEl instanceof DebugElement) {
      debugEl.classes[name] = true;
    }
    this.delegate.addClass(el, name);
  }

  removeClass(el: any, name: string): void {
    const debugEl = getDebugNode(el);
    if (debugEl && debugEl instanceof DebugElement) {
      debugEl.classes[name] = false;
    }
    this.delegate.removeClass(el, name);
  }

  setStyle(el: any, style: string, value: any, hasVendorPrefix: boolean, hasImportant: boolean):
      void {
    const debugEl = getDebugNode(el);
    if (debugEl && debugEl instanceof DebugElement) {
      debugEl.styles[style] = value;
    }
    this.delegate.setStyle(el, style, value, hasVendorPrefix, hasImportant);
  }

  removeStyle(el: any, style: string, hasVendorPrefix: boolean): void {
    const debugEl = getDebugNode(el);
    if (debugEl && debugEl instanceof DebugElement) {
      debugEl.styles[style] = null;
    }
    this.delegate.removeStyle(el, style, hasVendorPrefix);
  }

  setProperty(el: any, name: string, value: any): void {
    const debugEl = getDebugNode(el);
    if (debugEl && debugEl instanceof DebugElement) {
      debugEl.properties[name] = value;
    }
    this.delegate.setProperty(el, name, value);
  }

  listen(
      target: 'document'|'windows'|'body'|any, eventName: string,
      callback: (event: any) => boolean): () => void {
    if (typeof target !== 'string') {
      const debugEl = getDebugNode(target);
      if (debugEl) {
        debugEl.listeners.push(new EventListener(eventName, callback));
      }
    }

    return this.delegate.listen(target, eventName, callback);
  }

  parentNode(node: any): any { return this.delegate.parentNode(node); }
  nextSibling(node: any): any { return this.delegate.nextSibling(node); }
  setValue(node: any, value: string): void { return this.delegate.setValue(node, value); }
}

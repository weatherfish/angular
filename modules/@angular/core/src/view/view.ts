/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ViewEncapsulation} from '../metadata/view';
import {RendererTypeV2, RendererV2} from '../render/api';

import {checkAndUpdateElementDynamic, checkAndUpdateElementInline, createElement} from './element';
import {expressionChangedAfterItHasBeenCheckedError} from './errors';
import {appendNgContent} from './ng_content';
import {callLifecycleHooksChildrenFirst, checkAndUpdateDirectiveDynamic, checkAndUpdateDirectiveInline, createDirectiveInstance, createPipeInstance, createProviderInstance} from './provider';
import {checkAndUpdatePureExpressionDynamic, checkAndUpdatePureExpressionInline, createPureExpression} from './pure_expression';
import {checkAndUpdateQuery, createQuery, queryDef} from './query';
import {checkAndUpdateTextDynamic, checkAndUpdateTextInline, createText} from './text';
import {ArgumentType, ElementDef, NodeData, NodeDef, NodeFlags, NodeType, ProviderData, ProviderDef, RootData, Services, TextDef, ViewData, ViewDefinition, ViewDefinitionFactory, ViewFlags, ViewHandleEventFn, ViewState, ViewUpdateFn, asElementData, asProviderData, asPureExpressionData, asQueryList, asTextData} from './types';
import {checkBindingNoChanges, isComponentView, resolveViewDefinition, viewParentEl} from './util';

const NOOP = (): any => undefined;

export function viewDef(
    flags: ViewFlags, nodes: NodeDef[], updateDirectives?: ViewUpdateFn,
    updateRenderer?: ViewUpdateFn, handleEvent?: ViewHandleEventFn): ViewDefinition {
  // clone nodes and set auto calculated values
  if (nodes.length === 0) {
    throw new Error(`Illegal State: Views without nodes are not allowed!`);
  }

  const reverseChildNodes: NodeDef[] = new Array(nodes.length);
  let viewBindingCount = 0;
  let viewDisposableCount = 0;
  let viewNodeFlags = 0;
  let viewMatchedQueries = 0;
  let currentParent: NodeDef = null;
  let currentElementHasPublicProviders = false;
  let currentElementHasPrivateProviders = false;
  let lastRootNode: NodeDef = null;
  for (let i = 0; i < nodes.length; i++) {
    while (currentParent && i > currentParent.index + currentParent.childCount) {
      const newParent = currentParent.parent;
      if (newParent) {
        newParent.childFlags |= currentParent.childFlags;
        newParent.childMatchedQueries |= currentParent.childMatchedQueries;
      }
      currentParent = newParent;
    }
    const node = nodes[i];
    node.index = i;
    node.parent = currentParent;
    node.bindingIndex = viewBindingCount;
    node.disposableIndex = viewDisposableCount;
    node.reverseChildIndex =
        calculateReverseChildIndex(currentParent, i, node.childCount, nodes.length);

    // renderParent needs to account for ng-container!
    let currentRenderParent: NodeDef;
    if (currentParent && currentParent.type === NodeType.Element && !currentParent.element.name) {
      currentRenderParent = currentParent.renderParent;
    } else {
      currentRenderParent = currentParent;
    }
    node.renderParent = currentRenderParent;

    if (node.element) {
      const elDef = node.element;
      elDef.publicProviders =
          currentParent ? currentParent.element.publicProviders : Object.create(null);
      elDef.allProviders = elDef.publicProviders;
      // Note: We assume that all providers of an element are before any child element!
      currentElementHasPublicProviders = false;
      currentElementHasPrivateProviders = false;
    }
    reverseChildNodes[node.reverseChildIndex] = node;
    validateNode(currentParent, node, nodes.length);

    viewNodeFlags |= node.flags;
    viewMatchedQueries |= node.matchedQueryIds;
    if (node.element && node.element.template) {
      viewMatchedQueries |= node.element.template.nodeMatchedQueries;
    }
    if (currentParent) {
      currentParent.childFlags |= node.flags;
      currentParent.childMatchedQueries |= node.matchedQueryIds;
      if (node.element && node.element.template) {
        currentParent.childMatchedQueries |= node.element.template.nodeMatchedQueries;
      }
    }

    viewBindingCount += node.bindings.length;
    viewDisposableCount += node.disposableCount;

    if (!currentRenderParent) {
      lastRootNode = node;
    }
    if (node.type === NodeType.Provider || node.type === NodeType.Directive) {
      if (!currentElementHasPublicProviders) {
        currentElementHasPublicProviders = true;
        // Use protoypical inheritance to not get O(n^2) complexity...
        currentParent.element.publicProviders =
            Object.create(currentParent.element.publicProviders);
        currentParent.element.allProviders = currentParent.element.publicProviders;
      }
      const isPrivateService = (node.flags & NodeFlags.PrivateProvider) !== 0;
      const isComponent = (node.flags & NodeFlags.HasComponent) !== 0;
      if (!isPrivateService || isComponent) {
        currentParent.element.publicProviders[node.provider.tokenKey] = node;
      } else {
        if (!currentElementHasPrivateProviders) {
          currentElementHasPrivateProviders = true;
          // Use protoypical inheritance to not get O(n^2) complexity...
          currentParent.element.allProviders = Object.create(currentParent.element.publicProviders);
        }
        currentParent.element.allProviders[node.provider.tokenKey] = node;
      }
      if (isComponent) {
        currentParent.element.component = node;
      }
    }
    if (node.childCount) {
      currentParent = node;
    }
  }
  while (currentParent) {
    const newParent = currentParent.parent;
    if (newParent) {
      newParent.childFlags |= currentParent.childFlags;
      newParent.childMatchedQueries |= currentParent.childMatchedQueries;
    }
    currentParent = newParent;
  }
  return {
    nodeFlags: viewNodeFlags,
    nodeMatchedQueries: viewMatchedQueries, flags,
    nodes: nodes, reverseChildNodes,
    updateDirectives: updateDirectives || NOOP,
    updateRenderer: updateRenderer || NOOP,
    handleEvent: handleEvent || NOOP,
    bindingCount: viewBindingCount,
    disposableCount: viewDisposableCount, lastRootNode
  };
}

function calculateReverseChildIndex(
    currentParent: NodeDef, i: number, childCount: number, nodeCount: number) {
  // Notes about reverse child order:
  // - Every node is directly before its children, in dfs and reverse child order.
  // - node.childCount contains all children, in dfs and reverse child order.
  // - In dfs order, every node is before its first child
  // - In reverse child order, every node is before its last child

  // Algorithm, main idea:
  // - In reverse child order, the ranges for each child + its transitive children are mirrored
  //   regarding their position inside of their parent

  // Visualization:
  // Given the following tree:
  // Nodes: n0
  //             n1         n2
  //                n11 n12    n21 n22
  // dfs:    0   1   2   3  4   5   6
  // result: 0   4   6   5  1   3   2
  //
  // Example:
  // Current node = 1
  // 1) lastChildIndex = 3
  // 2) lastChildOffsetRelativeToParentInDfsOrder = 2
  // 3) parentEndIndexInReverseChildOrder = 6
  // 4) result = 4
  let lastChildOffsetRelativeToParentInDfsOrder: number;
  let parentEndIndexInReverseChildOrder: number;
  if (currentParent) {
    const lastChildIndex = i + childCount;
    lastChildOffsetRelativeToParentInDfsOrder = lastChildIndex - currentParent.index - 1;
    parentEndIndexInReverseChildOrder = currentParent.reverseChildIndex + currentParent.childCount;
  } else {
    lastChildOffsetRelativeToParentInDfsOrder = i + childCount;
    parentEndIndexInReverseChildOrder = nodeCount - 1;
  }
  return parentEndIndexInReverseChildOrder - lastChildOffsetRelativeToParentInDfsOrder;
}

function validateNode(parent: NodeDef, node: NodeDef, nodeCount: number) {
  const template = node.element && node.element.template;
  if (template) {
    if (template.lastRootNode && template.lastRootNode.flags & NodeFlags.HasEmbeddedViews) {
      throw new Error(
          `Illegal State: Last root node of a template can't have embedded views, at index ${node.index}!`);
    }
  }
  if (node.type === NodeType.Provider || node.type === NodeType.Directive) {
    const parentType = parent ? parent.type : null;
    if (parentType !== NodeType.Element) {
      throw new Error(
          `Illegal State: Provider/Directive nodes need to be children of elements or anchors, at index ${node.index}!`);
    }
  }
  if (node.query) {
    if (node.flags & NodeFlags.HasContentQuery && (!parent || parent.type !== NodeType.Directive)) {
      throw new Error(
          `Illegal State: Content Query nodes need to be children of directives, at index ${node.index}!`);
    }
    if (node.flags & NodeFlags.HasViewQuery && parent) {
      throw new Error(
          `Illegal State: View Query nodes have to be top level nodes, at index ${node.index}!`);
    }
  }
  if (node.childCount) {
    const parentEnd = parent ? parent.index + parent.childCount : nodeCount - 1;
    if (node.index <= parentEnd && node.index + node.childCount > parentEnd) {
      throw new Error(
          `Illegal State: childCount of node leads outside of parent, at index ${node.index}!`);
    }
  }
}

export function createEmbeddedView(parent: ViewData, anchorDef: NodeDef, context?: any): ViewData {
  // embedded views are seen as siblings to the anchor, so we need
  // to get the parent of the anchor and use it as parentIndex.
  const view =
      createView(parent.root, parent.renderer, parent, anchorDef, anchorDef.element.template);
  initView(view, parent.component, context);
  createViewNodes(view);
  return view;
}

export function createRootView(root: RootData, def: ViewDefinition, context?: any): ViewData {
  const view = createView(root, root.renderer, null, null, def);
  initView(view, context, context);
  createViewNodes(view);
  return view;
}

function createView(
    root: RootData, renderer: RendererV2, parent: ViewData, parentNodeDef: NodeDef,
    def: ViewDefinition): ViewData {
  const nodes: NodeData[] = new Array(def.nodes.length);
  const disposables = def.disposableCount ? new Array(def.disposableCount) : undefined;
  const view: ViewData = {
    def,
    parent,
    parentNodeDef,
    context: undefined,
    component: undefined, nodes,
    state: ViewState.FirstCheck | ViewState.ChecksEnabled, root, renderer,
    oldValues: new Array(def.bindingCount), disposables
  };
  return view;
}

function initView(view: ViewData, component: any, context: any) {
  view.component = component;
  view.context = context;
}

function createViewNodes(view: ViewData) {
  let renderHost: any;
  if (isComponentView(view)) {
    const hostDef = view.parentNodeDef;
    renderHost = asElementData(view.parent, hostDef.parent.index).renderElement;
  }
  const def = view.def;
  const nodes = view.nodes;
  for (let i = 0; i < def.nodes.length; i++) {
    const nodeDef = def.nodes[i];
    Services.setCurrentNode(view, i);
    switch (nodeDef.type) {
      case NodeType.Element:
        nodes[i] = createElement(view, renderHost, nodeDef) as any;
        break;
      case NodeType.Text:
        nodes[i] = createText(view, renderHost, nodeDef) as any;
        break;
      case NodeType.Provider: {
        const instance = createProviderInstance(view, nodeDef);
        const providerData = <ProviderData>{componentView: undefined, instance};
        nodes[i] = providerData as any;
        break;
      }
      case NodeType.Pipe: {
        const instance = createPipeInstance(view, nodeDef);
        const providerData = <ProviderData>{componentView: undefined, instance};
        nodes[i] = providerData as any;
        break;
      }
      case NodeType.Directive: {
        if (nodeDef.flags & NodeFlags.HasComponent) {
          // Components can inject a ChangeDetectorRef that needs a references to
          // the component view. Therefore, we create the component view first
          // and set the ProviderData in ViewData, and then instantiate the provider.
          const compViewDef = resolveViewDefinition(nodeDef.provider.component);
          const rendererType = nodeDef.provider.rendererType;
          let compRenderer: RendererV2;
          if (!rendererType) {
            compRenderer = view.root.renderer;
          } else {
            const hostEl = asElementData(view, nodeDef.parent.index).renderElement;
            compRenderer = view.root.rendererFactory.createRenderer(hostEl, rendererType);
          }
          const componentView = createView(view.root, compRenderer, view, nodeDef, compViewDef);
          const providerData = <ProviderData>{componentView, instance: undefined};
          nodes[i] = providerData as any;
          const instance = providerData.instance = createDirectiveInstance(view, nodeDef);
          initView(componentView, instance, instance);
        } else {
          const instance = createDirectiveInstance(view, nodeDef);
          const providerData = <ProviderData>{componentView: undefined, instance};
          nodes[i] = providerData as any;
        }
        break;
      }
      case NodeType.PureExpression:
        nodes[i] = createPureExpression(view, nodeDef) as any;
        break;
      case NodeType.Query:
        nodes[i] = createQuery() as any;
        break;
      case NodeType.NgContent:
        appendNgContent(view, renderHost, nodeDef);
        // no runtime data needed for NgContent...
        nodes[i] = undefined;
        break;
    }
  }
  // Create the ViewData.nodes of component views after we created everything else,
  // so that e.g. ng-content works
  execComponentViewsAction(view, ViewAction.CreateViewNodes);

  // fill static content and view queries
  execQueriesAction(
      view, NodeFlags.HasContentQuery | NodeFlags.HasViewQuery, NodeFlags.HasStaticQuery,
      QueryAction.CheckAndUpdate);
}

export function checkNoChangesView(view: ViewData) {
  Services.updateDirectives(checkNoChangesNode, view);
  execEmbeddedViewsAction(view, ViewAction.CheckNoChanges);
  execQueriesAction(
      view, NodeFlags.HasContentQuery, NodeFlags.HasDynamicQuery, QueryAction.CheckNoChanges);
  Services.updateRenderer(checkNoChangesNode, view);
  execComponentViewsAction(view, ViewAction.CheckNoChanges);
  execQueriesAction(
      view, NodeFlags.HasViewQuery, NodeFlags.HasDynamicQuery, QueryAction.CheckNoChanges);
}

export function checkAndUpdateView(view: ViewData) {
  Services.updateDirectives(checkAndUpdateNode, view);
  execEmbeddedViewsAction(view, ViewAction.CheckAndUpdate);
  execQueriesAction(
      view, NodeFlags.HasContentQuery, NodeFlags.HasDynamicQuery, QueryAction.CheckAndUpdate);

  callLifecycleHooksChildrenFirst(
      view, NodeFlags.AfterContentChecked |
          (view.state & ViewState.FirstCheck ? NodeFlags.AfterContentInit : 0));

  Services.updateRenderer(checkAndUpdateNode, view);

  execComponentViewsAction(view, ViewAction.CheckAndUpdate);
  execQueriesAction(
      view, NodeFlags.HasViewQuery, NodeFlags.HasDynamicQuery, QueryAction.CheckAndUpdate);

  callLifecycleHooksChildrenFirst(
      view, NodeFlags.AfterViewChecked |
          (view.state & ViewState.FirstCheck ? NodeFlags.AfterViewInit : 0));

  if (view.def.flags & ViewFlags.OnPush) {
    view.state &= ~ViewState.ChecksEnabled;
  }
  view.state &= ~ViewState.FirstCheck;
}

function checkAndUpdateNode(
    view: ViewData, nodeIndex: number, argStyle: ArgumentType, v0?: any, v1?: any, v2?: any,
    v3?: any, v4?: any, v5?: any, v6?: any, v7?: any, v8?: any, v9?: any): any {
  if (argStyle === ArgumentType.Inline) {
    return checkAndUpdateNodeInline(view, nodeIndex, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9);
  } else {
    return checkAndUpdateNodeDynamic(view, nodeIndex, v0);
  }
}

function checkAndUpdateNodeInline(
    view: ViewData, nodeIndex: number, v0?: any, v1?: any, v2?: any, v3?: any, v4?: any, v5?: any,
    v6?: any, v7?: any, v8?: any, v9?: any): any {
  const nodeDef = view.def.nodes[nodeIndex];
  switch (nodeDef.type) {
    case NodeType.Element:
      return checkAndUpdateElementInline(view, nodeDef, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9);
    case NodeType.Text:
      return checkAndUpdateTextInline(view, nodeDef, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9);
    case NodeType.Directive:
      return checkAndUpdateDirectiveInline(view, nodeDef, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9);
    case NodeType.PureExpression:
      return checkAndUpdatePureExpressionInline(
          view, nodeDef, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9);
  }
}

function checkAndUpdateNodeDynamic(view: ViewData, nodeIndex: number, values: any[]): any {
  const nodeDef = view.def.nodes[nodeIndex];
  switch (nodeDef.type) {
    case NodeType.Element:
      return checkAndUpdateElementDynamic(view, nodeDef, values);
    case NodeType.Text:
      return checkAndUpdateTextDynamic(view, nodeDef, values);
    case NodeType.Directive:
      return checkAndUpdateDirectiveDynamic(view, nodeDef, values);
    case NodeType.PureExpression:
      return checkAndUpdatePureExpressionDynamic(view, nodeDef, values);
  }
}

function checkNoChangesNode(
    view: ViewData, nodeIndex: number, argStyle: ArgumentType, v0?: any, v1?: any, v2?: any,
    v3?: any, v4?: any, v5?: any, v6?: any, v7?: any, v8?: any, v9?: any): any {
  if (argStyle === ArgumentType.Inline) {
    return checkNoChangesNodeInline(view, nodeIndex, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9);
  } else {
    return checkNoChangesNodeDynamic(view, nodeIndex, v0);
  }
}

function checkNoChangesNodeInline(
    view: ViewData, nodeIndex: number, v0: any, v1: any, v2: any, v3: any, v4: any, v5: any,
    v6: any, v7: any, v8: any, v9: any): void {
  const nodeDef = view.def.nodes[nodeIndex];
  // Note: fallthrough is intended!
  switch (nodeDef.bindings.length) {
    case 10:
      checkBindingNoChanges(view, nodeDef, 9, v9);
    case 9:
      checkBindingNoChanges(view, nodeDef, 8, v8);
    case 8:
      checkBindingNoChanges(view, nodeDef, 7, v7);
    case 7:
      checkBindingNoChanges(view, nodeDef, 6, v6);
    case 6:
      checkBindingNoChanges(view, nodeDef, 5, v5);
    case 5:
      checkBindingNoChanges(view, nodeDef, 4, v4);
    case 4:
      checkBindingNoChanges(view, nodeDef, 3, v3);
    case 3:
      checkBindingNoChanges(view, nodeDef, 2, v2);
    case 2:
      checkBindingNoChanges(view, nodeDef, 1, v1);
    case 1:
      checkBindingNoChanges(view, nodeDef, 0, v0);
  }
  return nodeDef.type === NodeType.PureExpression ? asPureExpressionData(view, nodeIndex).value :
                                                    undefined;
}

function checkNoChangesNodeDynamic(view: ViewData, nodeIndex: number, values: any[]): void {
  const nodeDef = view.def.nodes[nodeIndex];
  for (let i = 0; i < values.length; i++) {
    checkBindingNoChanges(view, nodeDef, i, values[i]);
  }
  return nodeDef.type === NodeType.PureExpression ? asPureExpressionData(view, nodeIndex).value :
                                                    undefined;
}

function checkNoChangesQuery(view: ViewData, nodeDef: NodeDef) {
  const queryList = asQueryList(view, nodeDef.index);
  if (queryList.dirty) {
    throw expressionChangedAfterItHasBeenCheckedError(
        Services.createDebugContext(view, nodeDef.index), `Query ${nodeDef.query.id} not dirty`,
        `Query ${nodeDef.query.id} dirty`, (view.state & ViewState.FirstCheck) !== 0);
  }
}

export function destroyView(view: ViewData) {
  execEmbeddedViewsAction(view, ViewAction.Destroy);
  execComponentViewsAction(view, ViewAction.Destroy);
  callLifecycleHooksChildrenFirst(view, NodeFlags.OnDestroy);
  if (view.disposables) {
    for (let i = 0; i < view.disposables.length; i++) {
      view.disposables[i]();
    }
  }
  if (view.renderer.destroyNode) {
    destroyViewNodes(view);
  }
  if (view.parentNodeDef && view.parentNodeDef.flags & NodeFlags.HasComponent) {
    view.renderer.destroy();
  }
  view.state |= ViewState.Destroyed;
}

function destroyViewNodes(view: ViewData) {
  const len = view.def.nodes.length;
  for (let i = 0; i < len; i++) {
    const def = view.def.nodes[i];
    if (def.type === NodeType.Element) {
      view.renderer.destroyNode(asElementData(view, i).renderElement);
    } else if (def.type === NodeType.Text) {
      view.renderer.destroyNode(asTextData(view, i).renderText);
    }
  }
}

enum ViewAction {
  CreateViewNodes,
  CheckNoChanges,
  CheckAndUpdate,
  Destroy
}

function execComponentViewsAction(view: ViewData, action: ViewAction) {
  const def = view.def;
  if (!(def.nodeFlags & NodeFlags.HasComponent)) {
    return;
  }
  for (let i = 0; i < def.nodes.length; i++) {
    const nodeDef = def.nodes[i];
    if (nodeDef.flags & NodeFlags.HasComponent) {
      // a leaf
      const providerData = asProviderData(view, i);
      callViewAction(providerData.componentView, action);
    } else if ((nodeDef.childFlags & NodeFlags.HasComponent) === 0) {
      // a parent with leafs
      // no child is a component,
      // then skip the children
      i += nodeDef.childCount;
    }
  }
}

function execEmbeddedViewsAction(view: ViewData, action: ViewAction) {
  const def = view.def;
  if (!(def.nodeFlags & NodeFlags.HasEmbeddedViews)) {
    return;
  }
  for (let i = 0; i < def.nodes.length; i++) {
    const nodeDef = def.nodes[i];
    if (nodeDef.flags & NodeFlags.HasEmbeddedViews) {
      // a leaf
      const embeddedViews = asElementData(view, i).embeddedViews;
      if (embeddedViews) {
        for (let k = 0; k < embeddedViews.length; k++) {
          callViewAction(embeddedViews[k], action);
        }
      }
    } else if ((nodeDef.childFlags & NodeFlags.HasEmbeddedViews) === 0) {
      // a parent with leafs
      // no child is a component,
      // then skip the children
      i += nodeDef.childCount;
    }
  }
}

function callViewAction(view: ViewData, action: ViewAction) {
  const viewState = view.state;
  switch (action) {
    case ViewAction.CheckNoChanges:
      if ((viewState & ViewState.ChecksEnabled) &&
          (viewState & (ViewState.Errored | ViewState.Destroyed)) === 0) {
        checkNoChangesView(view);
      }
      break;
    case ViewAction.CheckAndUpdate:
      if ((viewState & ViewState.ChecksEnabled) &&
          (viewState & (ViewState.Errored | ViewState.Destroyed)) === 0) {
        checkAndUpdateView(view);
      }
      break;
    case ViewAction.Destroy:
      destroyView(view);
      break;
    case ViewAction.CreateViewNodes:
      createViewNodes(view);
      break;
  }
}

enum QueryAction {
  CheckAndUpdate,
  CheckNoChanges
}

function execQueriesAction(
    view: ViewData, queryFlags: NodeFlags, staticDynamicQueryFlag: NodeFlags, action: QueryAction) {
  if (!(view.def.nodeFlags & queryFlags) || !(view.def.nodeFlags & staticDynamicQueryFlag)) {
    return;
  }
  const nodeCount = view.def.nodes.length;
  for (let i = 0; i < nodeCount; i++) {
    const nodeDef = view.def.nodes[i];
    if ((nodeDef.flags & queryFlags) && (nodeDef.flags & staticDynamicQueryFlag)) {
      Services.setCurrentNode(view, nodeDef.index);
      switch (action) {
        case QueryAction.CheckAndUpdate:
          checkAndUpdateQuery(view, nodeDef);
          break;
        case QueryAction.CheckNoChanges:
          checkNoChangesQuery(view, nodeDef);
          break;
      }
    }
    if (!(nodeDef.childFlags & queryFlags) || !(nodeDef.childFlags & staticDynamicQueryFlag)) {
      // no child has a matching query
      // then skip the children
      i += nodeDef.childCount;
    }
  }
}

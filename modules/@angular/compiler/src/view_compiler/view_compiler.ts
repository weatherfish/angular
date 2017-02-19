/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AnimationEntryCompileResult} from '../animation/animation_compiler';
import {CompileDirectiveMetadata, CompilePipeSummary} from '../compile_metadata';
import {CompilerConfig} from '../config';
import {CompilerInjectable} from '../injectable';
import * as o from '../output/output_ast';
import {ElementSchemaRegistry} from '../schema/element_schema_registry';
import {TemplateAst} from '../template_parser/template_ast';

import {CompileElement} from './compile_element';
import {CompileView} from './compile_view';
import {ComponentFactoryDependency, ComponentViewDependency, DirectiveWrapperDependency} from './deps';
import {bindView} from './view_binder';
import {buildView, finishView} from './view_builder';

export {ComponentFactoryDependency, ComponentViewDependency, DirectiveWrapperDependency} from './deps';

export class ViewCompileResult {
  constructor(
      public statements: o.Statement[], public viewClassVar: string, public rendererTypeVar: string,
      public dependencies:
          Array<ComponentViewDependency|ComponentFactoryDependency|DirectiveWrapperDependency>) {}
}

@CompilerInjectable()
export class ViewCompiler {
  constructor(private _genConfig: CompilerConfig, private _schemaRegistry: ElementSchemaRegistry) {}

  compileComponent(
      component: CompileDirectiveMetadata, template: TemplateAst[], styles: o.Expression,
      pipes: CompilePipeSummary[],
      compiledAnimations: AnimationEntryCompileResult[]): ViewCompileResult {
    const dependencies:
        Array<ComponentViewDependency|ComponentFactoryDependency|DirectiveWrapperDependency> = [];
    const view = new CompileView(
        component, this._genConfig, pipes, styles, compiledAnimations, 0,
        CompileElement.createNull(), [], dependencies);

    const statements: o.Statement[] = [];
    buildView(view, template, dependencies);
    // Need to separate binding from creation to be able to refer to
    // variables that have been declared after usage.
    bindView(view, template, this._schemaRegistry);
    finishView(view, statements);

    return new ViewCompileResult(
        statements, view.classExpr.name, view.rendererTypeName, dependencies);
  }
}

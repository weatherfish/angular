/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {InjectionToken, ɵisPromise as isPromise, ɵmerge as merge} from '@angular/core';
import {toPromise} from 'rxjs/operator/toPromise';
import {AsyncValidatorFn, Validator, ValidatorFn} from './directives/validators';
import {AbstractControl, FormControl, FormGroup} from './model';

function isEmptyInputValue(value: any): boolean {
  // we don't check for string here so it also works with arrays
  return value == null || value.length === 0;
}

/**
 * Providers for validators to be used for {@link FormControl}s in a form.
 *
 * Provide this using `multi: true` to add validators.
 *
 * ### Example
 *
 * {@example core/forms/ts/ng_validators/ng_validators.ts region='ng_validators'}
 * @stable
 */
export const NG_VALIDATORS = new InjectionToken<Array<Validator|Function>>('NgValidators');

/**
 * Providers for asynchronous validators to be used for {@link FormControl}s
 * in a form.
 *
 * Provide this using `multi: true` to add validators.
 *
 * See {@link NG_VALIDATORS} for more details.
 *
 * @stable
 */
export const NG_ASYNC_VALIDATORS =
    new InjectionToken<Array<Validator|Function>>('NgAsyncValidators');

const EMAIL_REGEXP =
    /^(?=.{1,254}$)(?=.{1,64}@)[-!#$%&'*+/0-9=?A-Z^_`a-z{|}~]+(\.[-!#$%&'*+/0-9=?A-Z^_`a-z{|}~]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/**
 * Provides a set of validators used by form controls.
 *
 * A validator is a function that processes a {@link FormControl} or collection of
 * controls and returns a map of errors. A null map means that validation has passed.
 *
 * ### Example
 *
 * ```typescript
 * var loginControl = new FormControl("", Validators.required)
 * ```
 *
 * @stable
 */
export class Validators {
  /**
   * Validator that compares the value of the given FormControls
   */
  static equalsTo(...fieldPaths: string[]): ValidatorFn {
    return function(control: FormControl): {[key: string]: any} {
      if (fieldPaths.length < 1) {
        throw new Error('You must compare to at least 1 other field');
      }

      for (let fieldName of fieldPaths) {
        let field = (<FormGroup>control.parent).get(fieldName);
        if (!field) {
          throw new Error(
              `Field: ${fieldName} undefined, are you sure that ${fieldName} exists in the group`);
        }

        if (field.value !== control.value) {
          return {'equalsTo': {'unequalField': fieldName}};
        }
      }
      return null;
    };
  }

  /**
   * Validator that requires controls to have a non-empty value.
   */
  static required(control: AbstractControl): {[key: string]: boolean} {
    return isEmptyInputValue(control.value) ? {'required': true} : null;
  }

  /**
   * Validator that requires control value to be true.
   */
  static requiredTrue(control: AbstractControl): {[key: string]: boolean} {
    return control.value === true ? null : {'required': true};
  }

  /**
   * Validator that performs email validation.
   */
  static email(control: AbstractControl): {[key: string]: boolean} {
    return EMAIL_REGEXP.test(control.value) ? null : {'email': true};
  }

  /**
   * Validator that requires controls to have a value of a minimum length.
   */
  static minLength(minLength: number): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
      if (isEmptyInputValue(control.value)) {
        return null;  // don't validate empty values to allow optional controls
      }
      const length: number = control.value ? control.value.length : 0;
      return length < minLength ?
          {'minlength': {'requiredLength': minLength, 'actualLength': length}} :
          null;
    };
  }

  /**
   * Validator that requires controls to have a value of a maximum length.
   */
  static maxLength(maxLength: number): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
      const length: number = control.value ? control.value.length : 0;
      return length > maxLength ?
          {'maxlength': {'requiredLength': maxLength, 'actualLength': length}} :
          null;
    };
  }

  /**
   * Validator that requires a control to match a regex to its value.
   */
  static pattern(pattern: string|RegExp): ValidatorFn {
    if (!pattern) return Validators.nullValidator;
    let regex: RegExp;
    let regexStr: string;
    if (typeof pattern === 'string') {
      regexStr = `^${pattern}$`;
      regex = new RegExp(regexStr);
    } else {
      regexStr = pattern.toString();
      regex = pattern;
    }
    return (control: AbstractControl): {[key: string]: any} => {
      if (isEmptyInputValue(control.value)) {
        return null;  // don't validate empty values to allow optional controls
      }
      const value: string = control.value;
      return regex.test(value) ? null :
                                 {'pattern': {'requiredPattern': regexStr, 'actualValue': value}};
    };
  }

  /**
   * No-op validator.
   */
  static nullValidator(c: AbstractControl): {[key: string]: boolean} { return null; }

  /**
   * Compose multiple validators into a single function that returns the union
   * of the individual error maps.
   */
  static compose(validators: ValidatorFn[]): ValidatorFn {
    if (!validators) return null;
    const presentValidators = validators.filter(isPresent);
    if (presentValidators.length == 0) return null;

    return function(control: AbstractControl) {
      return _mergeErrors(_executeValidators(control, presentValidators));
    };
  }

  static composeAsync(validators: AsyncValidatorFn[]): AsyncValidatorFn {
    if (!validators) return null;
    const presentValidators = validators.filter(isPresent);
    if (presentValidators.length == 0) return null;

    return function(control: AbstractControl) {
      const promises = _executeAsyncValidators(control, presentValidators).map(_convertToPromise);
      return Promise.all(promises).then(_mergeErrors);
    };
  }
}

function isPresent(o: any): boolean {
  return o != null;
}

function _convertToPromise(obj: any): Promise<any> {
  return isPromise(obj) ? obj : toPromise.call(obj);
}

function _executeValidators(control: AbstractControl, validators: ValidatorFn[]): any[] {
  return validators.map(v => v(control));
}

function _executeAsyncValidators(control: AbstractControl, validators: AsyncValidatorFn[]): any[] {
  return validators.map(v => v(control));
}

function _mergeErrors(arrayOfErrors: any[]): {[key: string]: any} {
  const res: {[key: string]: any} =
      arrayOfErrors.reduce((res: {[key: string]: any}, errors: {[key: string]: any}) => {
        return errors != null ? merge(res, errors) : res;
      }, {});
  return Object.keys(res).length === 0 ? null : res;
}

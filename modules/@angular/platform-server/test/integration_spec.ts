/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {PlatformLocation} from '@angular/common';
import {ApplicationRef, CompilerFactory, Component, NgModule, NgModuleRef, NgZone, PlatformRef, destroyPlatform, getPlatform} from '@angular/core';
import {async, inject} from '@angular/core/testing';
import {Http, HttpModule, Response, ResponseOptions, XHRBackend} from '@angular/http';
import {MockBackend, MockConnection} from '@angular/http/testing';
import {DOCUMENT} from '@angular/platform-browser';
import {getDOM} from '@angular/platform-browser/src/dom/dom_adapter';
import {INITIAL_CONFIG, PlatformState, ServerModule, platformDynamicServer, renderModule, renderModuleFactory} from '@angular/platform-server';

import {Subscription} from 'rxjs/Subscription';
import {filter} from 'rxjs/operator/filter';
import {first} from 'rxjs/operator/first';
import {toPromise} from 'rxjs/operator/toPromise';

@Component({selector: 'app', template: `Works!`})
class MyServerApp {
}

@NgModule({
  bootstrap: [MyServerApp],
  declarations: [MyServerApp],
  imports: [ServerModule],
  providers: [
    MockBackend,
    {provide: XHRBackend, useExisting: MockBackend},
  ]
})
class ExampleModule {
}

@Component({selector: 'app', template: `Works too!`})
class MyServerApp2 {
}

@NgModule({declarations: [MyServerApp2], imports: [ServerModule], bootstrap: [MyServerApp2]})
class ExampleModule2 {
}

@Component({selector: 'app', template: '{{text}}'})
class MyAsyncServerApp {
  text = '';

  ngOnInit() {
    Promise.resolve(null).then(() => setTimeout(() => { this.text = 'Works!'; }, 10));
  }
}

@NgModule(
    {declarations: [MyAsyncServerApp], imports: [ServerModule], bootstrap: [MyAsyncServerApp]})
class AsyncServerModule {
}

@Component({selector: 'app', template: `Works!`, styles: [':host { color: red; }']})
class MyStylesApp {
}

@NgModule({declarations: [MyStylesApp], imports: [ServerModule], bootstrap: [MyStylesApp]})
class ExampleStylesModule {
}

@NgModule({
  bootstrap: [MyServerApp],
  declarations: [MyServerApp],
  imports: [HttpModule, ServerModule],
  providers: [
    MockBackend,
    {provide: XHRBackend, useExisting: MockBackend},
  ]
})
export class HttpBeforeExampleModule {
}

@NgModule({
  bootstrap: [MyServerApp],
  declarations: [MyServerApp],
  imports: [ServerModule, HttpModule],
  providers: [
    MockBackend,
    {provide: XHRBackend, useExisting: MockBackend},
  ]
})
export class HttpAfterExampleModule {
}

@Component({selector: 'app', template: `<img [src]="'link'">`})
class ImageApp {
}

@NgModule({declarations: [ImageApp], imports: [ServerModule], bootstrap: [ImageApp]})
class ImageExampleModule {
}

export function main() {
  if (getDOM().supportsDOMEvents()) return;  // NODE only

  describe('platform-server integration', () => {
    beforeEach(() => {
      if (getPlatform()) destroyPlatform();
    });

    it('should bootstrap', async(() => {
         const platform = platformDynamicServer(
             [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);

         platform.bootstrapModule(ExampleModule).then((moduleRef) => {
           const doc = moduleRef.injector.get(DOCUMENT);
           expect(getDOM().getText(doc)).toEqual('Works!');
           platform.destroy();
         });
       }));

    it('should allow multiple platform instances', async(() => {
         const platform = platformDynamicServer(
             [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);

         const platform2 = platformDynamicServer(
             [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);


         platform.bootstrapModule(ExampleModule).then((moduleRef) => {
           const doc = moduleRef.injector.get(DOCUMENT);
           expect(getDOM().getText(doc)).toEqual('Works!');
           platform.destroy();
         });

         platform2.bootstrapModule(ExampleModule2).then((moduleRef) => {
           const doc = moduleRef.injector.get(DOCUMENT);
           expect(getDOM().getText(doc)).toEqual('Works too!');
           platform2.destroy();
         });
       }));

    it('adds styles to the root component', async(() => {
         const platform = platformDynamicServer(
             [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
         platform.bootstrapModule(ExampleStylesModule).then(ref => {
           const appRef: ApplicationRef = ref.injector.get(ApplicationRef);
           const app = appRef.components[0].location.nativeElement;
           expect(app.children.length).toBe(2);
           const style = app.children[1];
           expect(style.type).toBe('style');
           expect(style.children[0].data).toContain('color: red');
         });
       }));

    it('copies known properties to attributes', async(() => {
         const platform = platformDynamicServer(
             [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
         platform.bootstrapModule(ImageExampleModule).then(ref => {
           const appRef: ApplicationRef = ref.injector.get(ApplicationRef);
           const app = appRef.components[0].location.nativeElement;
           const img = getDOM().getElementsByTagName(app, 'img')[0] as any;
           expect(img.attribs['src']).toEqual('link');
         });
       }));

    describe('PlatformLocation', () => {
      it('is injectable', async(() => {
           const platform = platformDynamicServer(
               [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
           platform.bootstrapModule(ExampleModule).then(appRef => {
             const location: PlatformLocation = appRef.injector.get(PlatformLocation);
             expect(location.pathname).toBe('/');
             platform.destroy();
           });
         }));
      it('is configurable via INITIAL_CONFIG', () => {
        platformDynamicServer([{
          provide: INITIAL_CONFIG,
          useValue: {document: '<app></app>', url: 'http://test.com/deep/path?query#hash'}
        }])
            .bootstrapModule(ExampleModule)
            .then(appRef => {
              const location: PlatformLocation = appRef.injector.get(PlatformLocation);
              expect(location.pathname).toBe('/deep/path');
              expect(location.search).toBe('?query');
              expect(location.hash).toBe('#hash');
            });
      });
      it('handles empty search and hash portions of the url', () => {
        platformDynamicServer([{
          provide: INITIAL_CONFIG,
          useValue: {document: '<app></app>', url: 'http://test.com/deep/path'}
        }])
            .bootstrapModule(ExampleModule)
            .then(appRef => {
              const location: PlatformLocation = appRef.injector.get(PlatformLocation);
              expect(location.pathname).toBe('/deep/path');
              expect(location.search).toBe('');
              expect(location.hash).toBe('');
            });
      });
      it('pushState causes the URL to update', async(() => {
           const platform = platformDynamicServer(
               [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
           platform.bootstrapModule(ExampleModule).then(appRef => {
             const location: PlatformLocation = appRef.injector.get(PlatformLocation);
             location.pushState(null, 'Test', '/foo#bar');
             expect(location.pathname).toBe('/foo');
             expect(location.hash).toBe('#bar');
             platform.destroy();
           });
         }));
      it('allows subscription to the hash state', done => {
        const platform =
            platformDynamicServer([{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
        platform.bootstrapModule(ExampleModule).then(appRef => {
          const location: PlatformLocation = appRef.injector.get(PlatformLocation);
          expect(location.pathname).toBe('/');
          location.onHashChange((e: any) => {
            expect(e.type).toBe('hashchange');
            expect(e.oldUrl).toBe('/');
            expect(e.newUrl).toBe('/foo#bar');
            platform.destroy();
            done();
          });
          location.pushState(null, 'Test', '/foo#bar');
        });
      });
    });

    describe('render', () => {
      let doc: string;
      let called: boolean;
      let expectedOutput =
          '<html><head></head><body><app ng-version="0.0.0-PLACEHOLDER">Works!</app></body></html>';

      beforeEach(() => {
        // PlatformConfig takes in a parsed document so that it can be cached across requests.
        doc = '<html><head></head><body><app></app></body></html>';
        called = false;
      });
      afterEach(() => { expect(called).toBe(true); });

      it('using long from should work', async(() => {
           const platform =
               platformDynamicServer([{provide: INITIAL_CONFIG, useValue: {document: doc}}]);

           platform.bootstrapModule(AsyncServerModule)
               .then((moduleRef) => {
                 const applicationRef: ApplicationRef = moduleRef.injector.get(ApplicationRef);
                 return toPromise.call(first.call(
                     filter.call(applicationRef.isStable, (isStable: boolean) => isStable)));
               })
               .then((b) => {
                 expect(platform.injector.get(PlatformState).renderToString()).toBe(expectedOutput);
                 platform.destroy();
                 called = true;
               });
         }));

      it('using renderModule should work', async(() => {
           renderModule(AsyncServerModule, {document: doc}).then(output => {
             expect(output).toBe(expectedOutput);
             called = true;
           });
         }));

      it('using renderModuleFactory should work',
         async(inject([PlatformRef], (defaultPlatform: PlatformRef) => {
           const compilerFactory: CompilerFactory =
               defaultPlatform.injector.get(CompilerFactory, null);
           const moduleFactory =
               compilerFactory.createCompiler().compileModuleSync(AsyncServerModule);
           renderModuleFactory(moduleFactory, {document: doc}).then(output => {
             expect(output).toBe(expectedOutput);
             called = true;
           });
         })));
    });

    describe('http', () => {
      it('can inject Http', async(() => {
           const platform = platformDynamicServer(
               [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
           platform.bootstrapModule(ExampleModule).then(ref => {
             expect(ref.injector.get(Http) instanceof Http).toBeTruthy();
           });
         }));
      it('can make Http requests', async(() => {
           const platform = platformDynamicServer(
               [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
           platform.bootstrapModule(ExampleModule).then(ref => {
             const mock = ref.injector.get(MockBackend);
             const http = ref.injector.get(Http);
             ref.injector.get(NgZone).run(() => {
               NgZone.assertInAngularZone();
               mock.connections.subscribe((mc: MockConnection) => {
                 NgZone.assertInAngularZone();
                 expect(mc.request.url).toBe('/testing');
                 mc.mockRespond(new Response(new ResponseOptions({body: 'success!', status: 200})));
               });
               http.get('/testing').subscribe(resp => {
                 NgZone.assertInAngularZone();
                 expect(resp.text()).toBe('success!');
               });
             });
           });
         }));
      it('requests are macrotasks', async(() => {
           const platform = platformDynamicServer(
               [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
           platform.bootstrapModule(ExampleModule).then(ref => {
             const mock = ref.injector.get(MockBackend);
             const http = ref.injector.get(Http);
             expect(ref.injector.get(NgZone).hasPendingMacrotasks).toBeFalsy();
             ref.injector.get(NgZone).run(() => {
               NgZone.assertInAngularZone();
               mock.connections.subscribe((mc: MockConnection) => {
                 expect(ref.injector.get(NgZone).hasPendingMacrotasks).toBeTruthy();
                 mc.mockRespond(new Response(new ResponseOptions({body: 'success!', status: 200})));
               });
               http.get('/testing').subscribe(resp => { expect(resp.text()).toBe('success!'); });
             });
           });
         }));
      it('works when HttpModule is included before ServerModule', async(() => {
           const platform = platformDynamicServer(
               [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
           platform.bootstrapModule(HttpBeforeExampleModule).then(ref => {
             const mock = ref.injector.get(MockBackend);
             const http = ref.injector.get(Http);
             expect(ref.injector.get(NgZone).hasPendingMacrotasks).toBeFalsy();
             ref.injector.get(NgZone).run(() => {
               NgZone.assertInAngularZone();
               mock.connections.subscribe((mc: MockConnection) => {
                 expect(ref.injector.get(NgZone).hasPendingMacrotasks).toBeTruthy();
                 mc.mockRespond(new Response(new ResponseOptions({body: 'success!', status: 200})));
               });
               http.get('/testing').subscribe(resp => { expect(resp.text()).toBe('success!'); });
             });
           });
         }));
      it('works when HttpModule is included after ServerModule', async(() => {
           const platform = platformDynamicServer(
               [{provide: INITIAL_CONFIG, useValue: {document: '<app></app>'}}]);
           platform.bootstrapModule(HttpAfterExampleModule).then(ref => {
             const mock = ref.injector.get(MockBackend);
             const http = ref.injector.get(Http);
             expect(ref.injector.get(NgZone).hasPendingMacrotasks).toBeFalsy();
             ref.injector.get(NgZone).run(() => {
               NgZone.assertInAngularZone();
               mock.connections.subscribe((mc: MockConnection) => {
                 expect(ref.injector.get(NgZone).hasPendingMacrotasks).toBeTruthy();
                 mc.mockRespond(new Response(new ResponseOptions({body: 'success!', status: 200})));
               });
               http.get('/testing').subscribe(resp => { expect(resp.text()).toBe('success!'); });
             });
           });
         }));
    });
  });
}

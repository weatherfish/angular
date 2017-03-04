import { browser, element, by } from 'protractor';

export class SitePage {

  links = element.all(by.css('md-toolbar a'));
  docViewer = element(by.css('aio-doc-viewer'));
  codeExample = element.all(by.css('aio-doc-viewer pre > code'));
  featureLink = element(by.css('md-toolbar a[href="features"]'));

  navigateTo() {
    return browser.get('/');
  }

  getDocViewerText() {
    return this.docViewer.getText();
  }

}

var path = require('canonical-path');
var fs = require('fs');
var entities = require('entities');

/**
 * @dgService exampleInlineTagDef
 * @description
 * Process inline example tags (of the form {@example relativePath region -title='some title'
 * -stylePattern='{some style pattern}' }),
 * replacing them with code from a shredded file
 * Examples:
 * {@example core/application_spec.ts hello-app -title='Sample component' }
 * {@example core/application_spec.ts -region=hello-app -title='Sample component' }
 * @kind function
 */
module.exports = function exampleInlineTagDef(
    parseArgString, exampleMap, getExampleFilename, createDocMessage, log, collectExamples) {
  return {
    name: 'example',
    description:
        'Process inline example tags (of the form {@example some/uri Some Title}), replacing them with HTML anchors',


    handler: function(doc, tagName, tagDescription) {
      const EXAMPLES_FOLDERS = collectExamples.exampleFolders;

      var tagArgs = parseArgString(entities.decodeHTML(tagDescription));
      var unnamedArgs = tagArgs._;
      var relativePath = unnamedArgs[0];
      var regionName = tagArgs.region || (unnamedArgs.length > 1 ? unnamedArgs[1] : '');
      var title = tagArgs.title || (unnamedArgs.length > 2 ? unnamedArgs[2] : null);
      var stylePattern = tagArgs.stylePattern;  // TODO: not yet implemented here

      // Find the example in the folders
      var exampleFile;
      EXAMPLES_FOLDERS.some(
          EXAMPLES_FOLDER => { return exampleFile = exampleMap[EXAMPLES_FOLDER][relativePath]; });

      if (!exampleFile) {
        log.error(
            createDocMessage('Missing example file... relativePath: "' + relativePath + '".', doc));
        log.error(
            'Example files available are:',
            EXAMPLES_FOLDERS.map(
                EXAMPLES_FOLDER => Object.keys(exampleMap[EXAMPLES_FOLDER]).join('\n')));
        return '';
      }

      var sourceCode = exampleFile.regions[regionName];
      if (!sourceCode) {
        log.error(createDocMessage(
            'Missing example region... relativePath: "' + relativePath + '", region: "' +
                regionName + '".',
            doc));
        log.error('Regions available are:', Object.keys[exampleFile.regions]);
        return '';
      }

      return sourceCode.renderedContent;
    }
  };
};

const Jasmine = require('jasmine')
const path = require('path')
const JasmineConsoleReporter = require('jasmine-console-reporter')
const reporters = require('jasmine-reporters')
const jasmine = new Jasmine()
var junitReporter = new reporters.JUnitXmlReporter({
  savePath: path.join(__dirname, 'test_results'),
  consolidateAll: true
})
var reporter = new JasmineConsoleReporter({
  colors: 1,
  cleanStack: 3,
  verbosity: 4,
  listStyle: 'indent',
  activity: false
})
jasmine.addReporter(junitReporter)
jasmine.addReporter(reporter)
jasmine.showColors(true)
jasmine.loadConfigFile('jasmine.json')
jasmine.execute()
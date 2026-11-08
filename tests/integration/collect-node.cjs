'use strict';
// Register top-level tests without executing their bodies. Fail for unsupported suites.
const Module = require('node:module');
const path = require('node:path');
const original = Module._load;
let current;
const cases = [];
function test(name) { cases.push({ suite: 'node', file: current, name }); }
test.test = test;
for (const name of ['describe', 'it', 'skip', 'only', 'todo']) {
  test[name] = () => { throw new Error(`Unsupported test registration: ${name}`); };
}
Module._load = function (name, ...args) {
  return name === 'node:test' ? test : original.call(this, name, ...args);
};
const scripts = require('../../package.json').scripts.test.split(/\s+/).filter(s => s.endsWith('.test.js'));
for (current of scripts) require(path.resolve(current));
process.stdout.write(JSON.stringify(cases));

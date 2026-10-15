const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const constantsPath = path.join(__dirname, '../GUI/shared/constants.js');

function loadConstants(electron, electronProcess = {}, pathApi = path) {
  const context = {
    module: { exports: {} },
    __dirname: path.dirname(constantsPath),
    process: { versions: { electron: '27.0.0' }, resourcesPath: path.resolve('test-resources'), ...electronProcess },
    require: name => name === 'electron' ? electron : name === 'path' ? pathApi : require(name)
  };
  vm.runInNewContext(fs.readFileSync(constantsPath, 'utf8'), context);
  return context.module.exports;
}

test('packaged main and renderer resolve the same writable folders without defaultApp or remote', () => {
  const userData = path.resolve('test-user-data');
  const main = loadConstants({ app: { isPackaged: true, getPath: name => {
    assert.equal(name, 'userData');
    return userData;
  } } });
  const renderer = loadConstants({ ipcRenderer: { sendSync: channel => {
    assert.equal(channel, 'get-user-data-dir');
    return userData;
  } } });
  const dirs = { Front: 'front', Back: 'back', Output: 'output', Decklist: 'decklist', DoubleSided: 'double_sided', Data: 'data' };
  for (const [name, subdir] of Object.entries(dirs)) {
    assert.equal(main[`get${name}Dir`](), path.join(userData, subdir));
    assert.equal(renderer[`get${name}Dir`](), main[`get${name}Dir`]());
  }
  assert.equal(main.getCalibrationDir(), path.resolve('test-resources', 'calibration'));
  assert.equal(renderer.getCalibrationDir(), main.getCalibrationDir());
});

test('development continues to use the project game and calibration folders', () => {
  const main = loadConstants({ app: { isPackaged: false } }, { defaultApp: true });
  const renderer = loadConstants({ ipcRenderer: { sendSync: () => null } }, { defaultApp: true });
  const expected = path.resolve(__dirname, '../game/front');
  assert.equal(main.getFrontDir(), expected);
  assert.equal(renderer.getFrontDir(), expected);
  assert.equal(main.getCalibrationDir(), path.resolve(__dirname, '../calibration'));
});

for (const [platform, pathApi, userData, resourcesPath] of [
  ['win32', path.win32, 'C:\\Users\\Test User\\AppData\\Roaming\\Card Maker', 'C:\\Program Files\\Card Maker\\resources'],
  ['darwin', path.posix, '/Users/Test User/Library/Application Support/Card Maker', '/Applications/Card Maker.app/Contents/Resources'],
  ['linux', path.posix, '/home/test user/.config/Card Maker', '/opt/card-maker/resources']
]) {
  test(`${platform} packaged main and renderer agree on platform paths`, () => {
    const main = loadConstants({ app: { isPackaged: true, getPath: () => userData } }, { platform, resourcesPath }, pathApi);
    const renderer = loadConstants({ ipcRenderer: { sendSync: () => userData } }, { platform, resourcesPath }, pathApi);
    assert.equal(main.getOutputDir(), pathApi.join(userData, 'output'));
    assert.equal(renderer.getOutputDir(), main.getOutputDir());
    assert.equal(main.getCalibrationDir(), pathApi.join(resourcesPath, 'calibration'));
    assert.equal(renderer.getCalibrationDir(), main.getCalibrationDir());
  });
}

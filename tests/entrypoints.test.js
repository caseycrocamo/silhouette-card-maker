const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { getBuildTargets, executableNameFromScript, verifyBinaries } = require('../check_and_build_entrypoints');
const { getGuiBuildScript } = require('../build_gui');

test('entrypoint discovery accepts both quote styles and flexible whitespace', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-maker-entrypoints-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'single.py'), "if __name__ == '__main__':\n    main()\n");
  fs.writeFileSync(path.join(dir, 'double.py'), 'if __name__ == "__main__":\n    main()\n');
  fs.writeFileSync(path.join(dir, 'spaced.py'), 'if   __name__== "__main__" :\n    main()\n');
  fs.writeFileSync(path.join(dir, 'library.py'), 'def main():\n    pass\n');
  assert.deepEqual(getBuildTargets(dir), ['double.py', 'single.py', 'spaced.py']);
});

test('the CLI used by the Windows build includes the persistent PDF worker', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../check_and_build_entrypoints.js'), '--list-targets'], {
    cwd: os.tmpdir(), encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().split(/\r?\n/).includes('pdf_worker.py'));
});

test('packaging rejects a missing Windows worker even if a Unix worker exists', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-maker-binaries-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const script of getBuildTargets()) {
    fs.writeFileSync(path.join(dir, executableNameFromScript(script, true)), 'fixture');
  }
  fs.unlinkSync(path.join(dir, 'pdf_worker.exe'));
  fs.writeFileSync(path.join(dir, 'pdf_worker'), 'fixture');
  assert.throws(() => verifyBinaries({ platform: 'win32', binDir: dir }), /Missing Python executables.*pdf_worker\.exe/);
  fs.writeFileSync(path.join(dir, 'pdf_worker.exe'), 'fixture');
  assert.doesNotThrow(() => verifyBinaries({ platform: 'win32', binDir: dir }));
});

for (const [platform, script, extension] of [
  ['win32', 'dist:win', '.exe'], ['darwin', 'dist:mac', ''], ['linux', 'dist:linux', '']
]) {
  test(`${platform} selects native packaging and validates its own executable names`, t => {
    assert.equal(getGuiBuildScript(platform), script);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-maker-platform-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const target of getBuildTargets()) {
      const file = executableNameFromScript(target, platform === 'win32');
      fs.writeFileSync(path.join(dir, file), 'fixture');
    }
    assert.doesNotThrow(() => verifyBinaries({ platform, binDir: dir }));
    fs.unlinkSync(path.join(dir, `pdf_worker${extension}`));
    assert.throws(() => verifyBinaries({ platform, binDir: dir }), /pdf_worker/);
  });
}

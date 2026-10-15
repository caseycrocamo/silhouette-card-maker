'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const yaml = require('../GUI/node_modules/js-yaml');
const { verifyMetadata, verifyRelease } = require('../scripts/verify-release');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = 'Silhouette-Card-Maker-1.2.3-win-x64.exe';
  const content = Buffer.from('installer bytes');
  fs.writeFileSync(path.join(directory, artifact), content);
  const blockmap = Buffer.from('blockmap');
  fs.writeFileSync(path.join(directory, `${artifact}.blockmap`), blockmap);
  const data = { version: '1.2.3', files: [{ url: artifact, size: content.length,
    sha512: crypto.createHash('sha512').update(content).digest('base64'), blockMapSize: blockmap.length }] };
  fs.writeFileSync(path.join(directory, 'latest.yml'), yaml.dump(data));
  return { directory, artifact };
}

test('verifies metadata checksums and referenced blockmaps', t => {
  const { directory } = fixture(t);
  assert.equal(verifyMetadata(directory, 'latest.yml', '1.2.3').version, '1.2.3');
});

test('rejects checksum mismatches', t => {
  const { directory, artifact } = fixture(t);
  fs.writeFileSync(path.join(directory, artifact), 'tampered');
  assert.throws(() => verifyMetadata(directory, 'latest.yml', '1.2.3'), /size|checksum/);
});

test('rejects absent or malformed metadata and unsafe file references', t => {
  const { directory } = fixture(t);
  assert.throws(() => verifyMetadata(directory, 'latest-linux.yml', '1.2.3'), /Missing updater metadata/);
  fs.writeFileSync(path.join(directory, 'bad.yml'), 'files: [');
  assert.throws(() => verifyMetadata(directory, 'bad.yml', '1.2.3'), /Invalid YAML/);
  fs.writeFileSync(path.join(directory, 'unsafe.yml'), yaml.dump({ version: '1.2.3', files: [{ url: '../evil', size: 0, sha512: '' }] }));
  assert.throws(() => verifyMetadata(directory, 'unsafe.yml', '1.2.3'), /unsafe/);
});

test('rejects metadata whose artifact product name was rewritten by the publisher', t => {
  const { directory } = fixture(t);
  const wrongName = 'Silhouette Card Maker-1.2.3-win-x64.exe';
  fs.writeFileSync(path.join(directory, 'mismatch.yml'), yaml.dump({ version: '1.2.3', files: [{ url: wrongName, size: 1, sha512: 'invalid' }] }));
  assert.throws(() => verifyMetadata(directory, 'mismatch.yml', '1.2.3'), /product name or version/);
});

test('validates embedded AppImage blockmap footer and compressed map', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-check-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const name = 'Silhouette-Card-Maker-1.2.3-linux-x64.AppImage';
  const compressedMap = zlib.deflateRawSync(Buffer.from(JSON.stringify({ files: [] })));
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(compressedMap.length);
  const bytes = Buffer.concat([Buffer.from('appimage-payload'), compressedMap, footer]);
  fs.writeFileSync(path.join(directory, name), bytes);
  const metadata = { version: '1.2.3', files: [{ url: name, size: bytes.length,
    sha512: crypto.createHash('sha512').update(bytes).digest('base64'), blockMapSize: compressedMap.length }] };
  fs.writeFileSync(path.join(directory, 'latest-linux.yml'), yaml.dump(metadata));
  assert.equal(verifyMetadata(directory, 'latest-linux.yml', '1.2.3').version, '1.2.3');
  footer.writeUInt32BE(compressedMap.length + 1);
  const invalid = Buffer.concat([Buffer.from('appimage-payload'), compressedMap, footer]);
  fs.writeFileSync(path.join(directory, name), invalid);
  metadata.files[0].sha512 = crypto.createHash('sha512').update(invalid).digest('base64');
  fs.writeFileSync(path.join(directory, 'latest-linux.yml'), yaml.dump(metadata));
  assert.throws(() => verifyMetadata(directory, 'latest-linux.yml', '1.2.3'), /footer/);
});

test('checks required platform formats and architecture-specific macOS artifacts', t => {
  const { directory } = fixture(t);
  assert.throws(() => verifyRelease({ directory, version: '1.2.3', platforms: ['win'] }), /ZIP artifacts/);
  for (const name of [
    'Silhouette-Card-Maker-1.2.3-win-x64.zip',
    'Silhouette-Card-Maker-1.2.3-win-x64.exe.blockmap',
    'Silhouette-Card-Maker-1.2.3-linux-x64.AppImage',
    'Silhouette-Card-Maker-1.2.3-linux-x64.tar.gz',
    'Silhouette-Card-Maker-1.2.3-mac-x64.dmg',
    'Silhouette-Card-Maker-1.2.3-mac-x64.zip',
    'Silhouette-Card-Maker-1.2.3-mac-arm64.dmg',
    'Silhouette-Card-Maker-1.2.3-mac-arm64.zip'
  ]) fs.writeFileSync(path.join(directory, name), 'artifact');
  const linux = 'Silhouette-Card-Maker-1.2.3-linux-x64.AppImage';
  const linuxBytes = fs.readFileSync(path.join(directory, linux));
  fs.writeFileSync(path.join(directory, 'latest-linux.yml'), yaml.dump({ version: '1.2.3', files: [{ url: linux, size: linuxBytes.length, sha512: crypto.createHash('sha512').update(linuxBytes).digest('base64') }] }));
  assert.equal(verifyRelease({ directory, version: '1.2.3' }).artifactCount, 9);
});

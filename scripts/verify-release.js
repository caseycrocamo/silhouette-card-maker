#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const yaml = require(path.join(__dirname, '../GUI/node_modules/js-yaml'));

function fail(message) { throw new Error(message); }

function verifyMetadata(directory, filename, expectedVersion) {
  const metadataPath = path.join(directory, filename);
  if (!fs.existsSync(metadataPath)) fail(`Missing updater metadata: ${filename}`);
  let metadata;
  try { metadata = yaml.load(fs.readFileSync(metadataPath, 'utf8')); }
  catch (error) { fail(`Invalid YAML in ${filename}: ${error.message}`); }
  if (!metadata || metadata.version !== expectedVersion || !Array.isArray(metadata.files) || !metadata.files.length) {
    fail(`${filename} must contain version ${expectedVersion} and at least one file entry`);
  }
  for (const item of metadata.files) {
    const name = item && (item.url || item.path);
    if (!name || path.basename(name) !== name) fail(`${filename} contains an unsafe or missing artifact path`);
    if (!name.startsWith(`Silhouette-Card-Maker-${expectedVersion}-`)) fail(`${filename} references an artifact with the wrong product name or version: ${name}`);
    const artifactPath = path.join(directory, name);
    if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) fail(`${filename} references missing artifact ${name}`);
    const bytes = fs.readFileSync(artifactPath);
    if (item.size !== bytes.length) fail(`${name} has size ${bytes.length}, expected ${item.size}`);
    const actual = crypto.createHash('sha512').update(bytes).digest('base64');
    if (item.sha512 !== actual) fail(`${name} has an invalid SHA-512 checksum`);
    if (item.blockMapSize !== undefined) {
      if (/\.AppImage$/i.test(name)) {
        if (bytes.length < item.blockMapSize + 4 || bytes.readUInt32BE(bytes.length - 4) !== item.blockMapSize) fail(`Invalid embedded blockmap footer for ${name}`);
        try { JSON.parse(zlib.inflateRawSync(bytes.subarray(bytes.length - 4 - item.blockMapSize, bytes.length - 4)).toString('utf8')); }
        catch { fail(`Invalid embedded blockmap for ${name}`); }
      } else {
        const blockmap = `${artifactPath}.blockmap`;
        if (!fs.existsSync(blockmap) || fs.statSync(blockmap).size !== item.blockMapSize) fail(`Missing or invalid blockmap for ${name}`);
      }
    }
  }
  return metadata;
}

function verifyRelease({ directory, version, platforms = ['win', 'linux', 'mac'] }) {
  const names = fs.readdirSync(directory);
  const has = pattern => names.some(name => pattern.test(name));
  if (platforms.includes('win')) {
    const metadata = verifyMetadata(directory, 'latest.yml', version);
    const prefix = `Silhouette-Card-Maker-${escapeRegExp(version)}`;
    if (!has(new RegExp(`^${prefix}-win-x64\\.exe$`)) || !has(new RegExp(`^${prefix}-win-x64\\.zip$`))) fail('Windows x64 NSIS and ZIP artifacts are required');
    const installer = names.find(name => new RegExp(`^${prefix}-win-x64\\.exe$`, 'i').test(name));
    const installerBlockmap = installer && path.join(directory, `${installer}.blockmap`);
    if (!installerBlockmap || !fs.existsSync(installerBlockmap) || fs.statSync(installerBlockmap).size === 0) fail('Windows NSIS installer blockmap is required');
    if (!metadata.files.some(file => new RegExp(`^${prefix}-win-x64\\.exe$`, 'i').test(file.url || file.path))) fail('Windows metadata must reference the matching x64 NSIS installer');
    for (const file of metadata.files) if (!new RegExp(`^${prefix}-win-x64\\.(?:exe|zip)$`, 'i').test(file.url || file.path)) fail(`Windows metadata references an artifact with the wrong version or architecture: ${file.url || file.path}`);
  }
  if (platforms.includes('linux')) {
    const metadata = verifyMetadata(directory, 'latest-linux.yml', version);
    const prefix = `Silhouette-Card-Maker-${escapeRegExp(version)}`;
    if (!has(new RegExp(`^${prefix}-linux-x64\\.AppImage$`)) || !has(new RegExp(`^${prefix}-linux-x64\\.tar\\.gz$`))) fail('Linux x64 AppImage and tar.gz artifacts are required');
    if (!metadata.files.some(file => new RegExp(`^${prefix}-linux-x64\\.AppImage$`, 'i').test(file.url || file.path))) fail('Linux metadata must reference the matching x64 AppImage');
    for (const file of metadata.files) if (!new RegExp(`^${prefix}-linux-x64\\.(?:AppImage|tar\\.gz)$`, 'i').test(file.url || file.path)) fail(`Linux metadata references an artifact with the wrong version or architecture: ${file.url || file.path}`);
  }
  if (platforms.includes('mac')) {
    for (const arch of ['x64', 'arm64']) for (const ext of ['dmg', 'zip']) {
      if (!has(new RegExp(`^Silhouette-Card-Maker-${escapeRegExp(version)}-mac-${arch}\\.${ext}$`, 'i'))) fail(`Missing macOS ${arch} ${ext} artifact`);
    }
  }
  return { version, platforms, artifactCount: names.filter(name => !/\.ya?ml$/i.test(name)).length };
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

if (require.main === module) {
  try {
    const directory = path.resolve(process.argv[2] || '.');
    const version = process.argv[3];
    const platforms = (process.argv[4] || 'win,linux,mac').split(',').filter(Boolean);
    if (!version) fail('Usage: node scripts/verify-release.js <directory> <version> [win,linux,mac]');
    console.log(JSON.stringify(verifyRelease({ directory, version, platforms })));
  } catch (error) {
    console.error(`Release verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyMetadata, verifyRelease };

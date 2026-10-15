'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const provider = require('../GUI/Utilities/releaseProvider');

test('release selection excludes drafts and prereleases and normalizes v tags', () => {
  const result = provider.findLatestStableRelease([
    { tag_name: 'v2.0.0-beta.1', prerelease: false, draft: false },
    { tag_name: 'v1.9.0', prerelease: false, draft: true },
    { tag_name: 'v1.4.0', prerelease: false, draft: false, body: 'Notes' },
    { tag_name: 'v1.3.9', prerelease: false, draft: false },
  ], '1.3.0');
  assert.equal(result.version, '1.4.0');
  assert.equal(result.releaseNotes, 'Notes');
  assert.equal(result.releaseUrl, 'https://github.com/caseycrocamo/silhouette-card-maker/releases');
});

test('release selection does not return invalid versions or downgrades', () => {
  assert.equal(provider.findLatestStableRelease([{ tag_name: 'v0.9.0' }], '1.0.0'), null);
  assert.equal(provider.normalizeVersion('release-1.2'), null);
});

test('release API follows only the fixed repository pagination links', async () => {
  const urls = [];
  const request = (url, options, callback) => {
    urls.push(url);
    const req = new EventEmitter();
    req.destroy = (error) => req.emit('error', error);
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = urls.length === 1
        ? { link: '<https://api.github.com/repos/caseycrocamo/silhouette-card-maker/releases?page=2&per_page=100>; rel="next"' }
        : {};
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify([{ tag_name: `v1.${urls.length}.0` }])));
      res.emit('end');
    });
    return req;
  };
  const releases = await provider.requestReleases({ request });
  assert.equal(releases.length, 2);
  assert.equal(releases.complete, true);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /per_page=100/);
  assert.match(urls[1], /page=2/);
});

test('release API rate-limit dates become bounded retry delays', async () => {
  const now = Date.now();
  const request = (url, options, callback) => {
    const req = new EventEmitter();
    req.destroy = (error) => req.emit('error', error);
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = 429;
      res.headers = { 'retry-after': new Date(now + 90_000).toUTCString() };
      callback(res);
      res.emit('end');
    });
    return req;
  };
  await assert.rejects(provider.requestReleases({ request, now: () => now }), (error) => {
    assert.ok(error.retryAfterMs <= 90_000 && error.retryAfterMs >= 89_000);
    return true;
  });
});

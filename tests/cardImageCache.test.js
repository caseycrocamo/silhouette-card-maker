"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createImageCache, imageUrl, requestImage } = require("../GUI/Utilities/cardImageCache");
const { EventEmitter } = require("node:events");
const url = "https://cards.scryfall.io/card.png";
const image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });

test("Unicode filename headers do not crash image downloads", async () => {
  const net = { request(options) {
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    const request = new EventEmitter();
    request.abort = () => request.emit("abort");
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { "content-type": ["image/png"], "content-disposition": ["inline; filename=Sol Ring ★.png"] };
      request.emit("response", response);
      response.emit("data", Buffer.from([1, 2, 3]));
      response.emit("end");
    };
    return request;
  } };
  const cache = createImageCache((url, options) => requestImage(url, options, net));
  assert.deepEqual((await cache.get(url)).bytes, Buffer.from([1, 2, 3]));
});

test("concurrent previews and later requests share the same image bytes", async () => {
  let calls = 0;
  const cache = createImageCache(async (_url, options) => {
    calls++;
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    return image();
  });
  const first = cache.get(url);
  assert.equal(first, cache.get(url));
  assert.equal(await first, await cache.get(url));
  assert.deepEqual((await first).bytes, Buffer.from([1, 2, 3]));
  assert.equal(calls, 1);
});

test("clearing a session drops image bytes and the next session downloads again", async () => {
  let calls = 0;
  const cache = createImageCache(async () => { calls++; return image(); });
  await cache.get(url);
  cache.clear();
  await cache.get(url);
  assert.equal(calls, 2);
});

test("clearing aborts downloads and late responses cannot refill the cache", async () => {
  let complete, signal;
  const cache = createImageCache(async (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { complete = resolve; });
  });
  const pending = cache.get(url);
  cache.clear();
  assert(signal.aborted);
  complete(image());
  await assert.rejects(pending, /canceled/);
});

test("failed downloads are removed so Retry can fetch again", async () => {
  let calls = 0;
  const cache = createImageCache(async () => {
    if (++calls === 1) throw new Error("offline");
    return image();
  });
  await assert.rejects(cache.get(url), /offline/);
  assert.equal((await cache.get(url)).mimeType, "image/png");
  assert.equal(calls, 2);
});

test("HTTP failures, non-images, empty images and oversized images are not cached", async () => {
  for (const response of [
    () => new Response("bad", { status: 404 }),
    () => new Response("bad", { headers: { "content-type": "text/html" } }),
    () => new Response(new Uint8Array(), { headers: { "content-type": "image/png" } }),
    () => new Response("bad", { headers: { "content-type": "image/png", "content-length": String(21 * 1024 * 1024) } }),
  ]) {
    let calls = 0;
    const cache = createImageCache(async () => { calls++; return response(); });
    await assert.rejects(cache.get(url));
    await assert.rejects(cache.get(url));
    assert.equal(calls, 2);
  }
});

test("image cache rejects foreign hosts, local files and URL credentials", () => {
  for (const source of ["https://example.com/a.png", "file:///tmp/a.png", "http://cards.scryfall.io/a.png", "https://user:pass@cards.scryfall.io/a.png"]) {
    assert.throws(() => imageUrl(source));
  }
  assert.equal(imageUrl(url + "#fragment"), url);
});

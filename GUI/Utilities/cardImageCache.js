"use strict";

const path = require("node:path");
const { ReadableStream } = require("node:stream/web");

// net.fetch converts every response header to a WHATWG Headers object. Electron
// 27 can throw outside the promise when a filename header contains Unicode.
// Read the response stream directly and inspect only the headers we need.
function requestImage(url, { signal } = {}, net = require("electron").net) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Card image request canceled."));
    const request = net.request({ url, cache: "no-store", credentials: "omit", redirect: "error" });
    let bodyController;
    let finished = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const fail = error => {
      if (finished) return;
      finished = true;
      cleanup();
      bodyController?.error(error);
      reject(error);
    };
    const abort = () => request.abort();
    request.on("abort", () => fail(new Error("Card image request canceled.")));
    request.on("error", fail);
    signal?.addEventListener("abort", abort, { once: true });
    request.on("response", response => {
      const body = new ReadableStream({
        start(controller) {
          bodyController = controller;
          response.on("data", chunk => { if (!finished) controller.enqueue(chunk); });
          response.on("end", () => {
            if (finished) return;
            finished = true;
            cleanup();
            controller.close();
          });
          response.on("error", fail);
          response.on("aborted", () => fail(new Error("Card image download interrupted.")));
        },
        cancel: abort,
      });
      resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        headers: { get(name) {
          const value = response.headers[name.toLowerCase()];
          return Array.isArray(value) ? value[0] : value;
        } },
        body,
      });
    });
    request.end();
  });
}

function imageUrl(value) {
  if (typeof value !== "string") throw new Error("Invalid card image URL.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["cards.scryfall.io", "api.scryfall.com"].includes(url.hostname)) {
    throw new Error("Invalid card image URL.");
  }
  url.hash = "";
  return url.href;
}

// The main process owns the bytes so they survive page navigation. Nothing is
// written to disk, including Chromium's HTTP cache.
function createImageCache(fetchImage) {
  const entries = new Map();
  let generation = 0;
  function get(value) {
    const url = imageUrl(value);
    if (entries.has(url)) return entries.get(url).promise;
    const controller = new AbortController();
    const token = generation;
    const entry = { controller };
    entries.set(url, entry);
    entry.promise = (async () => {
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetchImage(url, {
          signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error",
        });
        if (!response.ok) throw new Error(`Card image request failed: ${response.status}`);
        const mimeType = response.headers.get("content-type")?.split(";")[0] || "";
        if (!mimeType.startsWith("image/")) throw new Error("The response is not a card image.");
        const limit = 20 * 1024 * 1024;
        if (Number(response.headers.get("content-length")) > limit) throw new Error("Card image is too large.");
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          length += chunk.byteLength;
          if (length > limit) {
            controller.abort();
            throw new Error("Card image is too large.");
          }
          chunks.push(Buffer.from(chunk));
        }
        if (!length) throw new Error("Card image is empty.");
        if (token !== generation || controller.signal.aborted) throw new Error("Card image request canceled.");
        return { bytes: Buffer.concat(chunks), mimeType };
      } catch (error) {
        controller.abort();
        if (entries.get(url) === entry) entries.delete(url);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    })();
    return entry.promise;
  }
  function clear() {
    generation++;
    for (const entry of entries.values()) entry.controller.abort();
    entries.clear();
  }
  return { get, clear };
}

const imageCache = createImageCache(requestImage);

function registerCardImageCache({ app, ipcMain, isTrusted } = require("electron")) {
  const trusted = isTrusted || (event => require("./updateIpc").isTrustedUpdateSender(event, path.resolve(__dirname, "..")));
  ipcMain.handle("card-image:get", (event, url) => {
    if (!trusted(event)) throw new Error("Card images are only available to application pages.");
    return imageCache.get(url);
  });
  app.on("before-quit", imageCache.clear);
  app.on("window-all-closed", imageCache.clear);
  app.on("will-quit", () => {
    imageCache.clear();
    ipcMain.removeHandler("card-image:get");
  });
}

module.exports = { createImageCache, imageUrl, requestImage, getCardImage: imageCache.get, registerCardImageCache };

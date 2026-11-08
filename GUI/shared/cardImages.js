"use strict";

// Blob URLs avoid another image request when a list, preview, or card tile is
// rebuilt. The main-process cache keeps the original bytes across page changes.
const images = new Map();

function cachedImageUrl(source) {
  if (!source.startsWith("https:")) return Promise.resolve(source);
  if (images.has(source)) return images.get(source).promise;
  const entry = {};
  images.set(source, entry);
  entry.promise = require("electron").ipcRenderer.invoke("card-image:get", source)
    .then(({ bytes, mimeType }) => {
      entry.url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      return entry.url;
    }).catch(error => {
      if (images.get(source) === entry) images.delete(source);
      throw error;
    });
  return entry.promise;
}

function setCardImage(image, source) {
  image.dataset.imageSource = source;
  image.dispatchEvent(new Event("imageloadstart"));
  cachedImageUrl(source).then(url => {
    if (image.dataset.imageSource === source) image.src = url;
  }).catch(() => {
    if (image.dataset.imageSource === source) image.dispatchEvent(new Event("error"));
  });
}

if (typeof window !== "undefined") window.addEventListener("unload", () => {
  for (const image of images.values()) if (image.url) URL.revokeObjectURL(image.url);
  images.clear();
});

module.exports = { cachedImageUrl, setCardImage };

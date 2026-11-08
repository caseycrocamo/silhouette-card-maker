"use strict";

const DEFAULT_PAGE_SIZE = 25;
const STORAGE_KEY = "printingPageSize";

function validatePageSize(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 200) {
    throw new Error("Enter a whole number from 1 to 200.");
  }
  return size;
}

function readPageSize(storage) {
  try {
    return validatePageSize((storage || window.localStorage).getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

function savePageSize(value, storage) {
  const size = validatePageSize(value);
  (storage || window.localStorage).setItem(STORAGE_KEY, String(size));
  return size;
}

module.exports = { DEFAULT_PAGE_SIZE, STORAGE_KEY, validatePageSize, readPageSize, savePageSize };

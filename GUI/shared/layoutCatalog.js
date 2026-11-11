"use strict";
function hasLayout(metadata, card, paper, variant = "default") {
  return (metadata?.layouts || []).some(x =>
    String(x.card_size).toLowerCase() === String(card).toLowerCase() &&
    String(x.paper_size).toLowerCase() === String(paper).toLowerCase() &&
    (!x.variants || x.variants.some(v => v.name === variant)));
}
function refreshMetadata(current, next) {
  const draft = current || {};
  const variant = draft.borderless ? "borderless" : "default";
  const valid = hasLayout(next, draft.card_size, draft.paper_size, variant);
  return { metadata: next, invalidSelection: !valid && !!(draft.card_size || draft.paper_size) };
}
module.exports = { hasLayout, refreshMetadata };

"use strict";
function createController({
  adapter,
  onChange = () => {},
  onDraft = () => {},
}) {
  let generation = 0;
  const state = { entries: [], errors: [], warnings: [], status: "empty", draft: "", progress: null };
  const notify = () => onChange(state);
  // Adopt imported text without canceling the search that is loading it.
  function replaceDraft(text) {
    state.draft = text;
    onDraft(text);
    notify();
  }
  function dirty(text) {
    generation++;
    state.draft = text;
    state.status = text.trim() ? "dirty" : "empty";
    state.entries = [];
    state.errors = [];
    state.warnings = [];
    state.progress = null;
    onDraft(text);
    notify();
  }
  function stale() {
    generation++;
    state.status = state.draft.trim() ? "dirty" : "empty";
    notify();
  }
  async function search(text = state.draft, retry = false) {
    const previousErrors = state.errors;
    const previousEntries = new Map(state.entries.filter(e => e.status === "ready").map(e => [e.id, e]));
    const token = ++generation;
    state.draft = text;
    state.status = "loading";
    state.progress = null;
    if (!retry) state.errors = [];
    notify();
    try {
      const parsed = retry && !adapter.reimportOnRetry
        ? { entries: state.entries, errors: previousErrors }
        : await adapter.parse(text, { isCurrent: () => token === generation, onProgress: progress => {
          if (token !== generation) return;
          if (progress.reset) state.entries = [];
          state.progress = {completed:progress.completed,total:progress.total};
          if (progress.errors) state.errors = progress.errors;
          for (const item of progress.entries || []) {
            const previous = retry && adapter.preserveResolvedOnRetry ? previousEntries.get(item.id) : null;
            const printing = previous?.printing || item.printing;
            const entry = {...item,printing,status:printing ? "ready" : "error"};
            const index = state.entries.findIndex(existing => existing.id === item.id);
            if (index < 0) state.entries.push(entry); else state.entries[index] = entry;
          }
          notify();
        } });
      if (token !== generation) return;
      const streamed = new Map(state.progress ? state.entries.map(entry => [entry.id,entry]) : []);
      state.entries = parsed.entries.map(e => {
        const old = streamed.get(e.id);
        const sameImages = old?.printing && e.printing && old.printing.id === e.printing.id &&
          JSON.stringify(old.printing.faces) === JSON.stringify(e.printing.faces);
        const printing = retry && adapter.preserveResolvedOnRetry && previousEntries.has(e.id)
          ? previousEntries.get(e.id).printing : sameImages ? old.printing : e.printing;
        return Object.assign(old || {}, e, {printing,status:printing ? "ready" : "loading"});
      });
      state.errors = parsed.errors || [];
      state.warnings = parsed.warnings || [];
      notify();
      const resolved = new Map();
      for (const entry of state.entries) {
        if (entry.status === "ready") continue;
        try {
          const identity = JSON.stringify([
            entry.printing?.id,
            entry.name,
            entry.setCode,
            entry.number,
          ]);
          if (!resolved.has(identity))
            resolved.set(
              identity,
              Promise.resolve().then(() => adapter.resolve(entry)),
            );
          const printing = await resolved.get(identity);
          if (token !== generation) return;
          entry.printing = printing;
          entry.error = "";
          entry.status = "ready";
        } catch (error) {
          if (token !== generation) return;
          entry.error = error.message;
          entry.status = "error";
        }
        notify();
      }
      if (token !== generation) return;
      state.progress = null;
      state.status = state.entries.some((e) => e.status !== "ready")
        ? "error"
        : state.errors.length && adapter.allowPartial
          ? "partial"
          : state.errors.length
            ? "error"
            : state.entries.length ? "ready" : "empty";
      if (state.status === "ready" || state.status === "partial") {
        state.draft = adapter.serialize(state.entries);
        onDraft(state.draft);
      }
      notify();
    } catch (error) {
      if (token !== generation) return;
      state.errors = [{ message: error.message }];
      state.progress = null;
      state.status = "error";
      notify();
    }
  }
  function applyPrinting(entry, printing, expectedPrinting) {
    if (
      state.status !== "ready" ||
      !state.entries.includes(entry) ||
      (expectedPrinting && entry.printing !== expectedPrinting)
    )
      return false;
    if (
      !printing ||
      !printing.setCode ||
      !printing.number ||
      !printing.faces?.length
    )
      return false;
    entry.printing = printing;
    entry.setCode = printing.setCode;
    entry.number = printing.number;
    entry.printingError = "";
    state.draft = adapter.serialize(state.entries);
    onDraft(state.draft);
    notify();
    return true;
  }
  async function changePrinting(entry, setCode) {
    const token = generation,
      request = (entry.printingRequest || 0) + 1;
    entry.printingRequest = request;
    entry.printingError = "";
    entry.changing = true;
    notify();
    try {
      const printing = await adapter.resolve({ ...entry, setCode, number: "" });
      if (
        token !== generation ||
        entry.printingRequest !== request ||
        !state.entries.includes(entry)
      )
        return;
      entry.printing = printing;
      state.draft = adapter.serialize(state.entries);
      onDraft(state.draft);
    } catch (error) {
      if (token !== generation || entry.printingRequest !== request) return;
      entry.printingError =
        "Unable to load this printing. The previous printing is still selected.";
    } finally {
      if (token === generation && entry.printingRequest === request) {
        entry.changing = false;
        notify();
      }
    }
  }
  function changeQuantity(entry, delta) {
    if (!["ready", "partial", "error"].includes(state.status) ||
        !state.entries.includes(entry) || ![-1, 1].includes(delta)) return false;
    const quantity = entry.qty + delta;
    if (!Number.isSafeInteger(quantity) || quantity < 0) return false;
    if (quantity === 0) state.entries = state.entries.filter(item => item !== entry);
    else entry.qty = quantity;
    state.status = state.entries.some(item => item.status !== "ready") ? "error" :
      state.errors.length ? (adapter.allowPartial ? "partial" : "error") :
        state.entries.length ? "ready" : "empty";
    state.draft = adapter.serialize(state.entries);
    onDraft(state.draft);
    notify();
    return true;
  }
  return {
    state,
    dirty,
    stale,
    search,
    changePrinting,
    applyPrinting,
    changeQuantity,
    replaceDraft,
    canExport: () =>
      Boolean(state.entries.length && (state.status === "ready" || (adapter.allowPartial && state.status === "partial")) && !state.entries.some((e) => e.changing)),
    cancel: () => generation++,
  };
}
module.exports = { createController };

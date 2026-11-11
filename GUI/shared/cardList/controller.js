"use strict";
function createController({
  adapter,
  onChange = () => {},
  onDraft = () => {},
}) {
  let generation = 0;
  const state = { entries: [], errors: [], warnings: [], status: "empty", draft: "" };
  const notify = () => onChange(state);
  function dirty(text) {
    generation++;
    state.draft = text;
    state.status = text.trim() ? "dirty" : "empty";
    state.entries = [];
    state.errors = [];
    state.warnings = [];
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
    if (!retry) state.errors = [];
    notify();
    try {
      const parsed = retry && !adapter.reimportOnRetry
        ? { entries: state.entries, errors: previousErrors }
        : await adapter.parse(text);
      if (token !== generation) return;
      state.entries = parsed.entries.map((e) => ({
        ...e,
        ...(retry && adapter.preserveResolvedOnRetry && previousEntries.has(e.id) ? {printing: previousEntries.get(e.id).printing} : {}),
        status: (e.printing || (adapter.preserveResolvedOnRetry && previousEntries.has(e.id))) && retry ? "ready" : "loading",
      }));
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
  return {
    state,
    dirty,
    stale,
    search,
    changePrinting,
    applyPrinting,
    canExport: () =>
      Boolean((state.status === "ready" || (adapter.allowPartial && state.status === "partial")) && !state.entries.some((e) => e.changing)),
    cancel: () => generation++,
  };
}
module.exports = { createController };

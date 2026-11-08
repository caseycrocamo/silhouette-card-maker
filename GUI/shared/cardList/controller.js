"use strict";
function createController({
  adapter,
  onChange = () => {},
  onDraft = () => {},
}) {
  let generation = 0;
  const state = { entries: [], errors: [], status: "empty", draft: "" };
  const notify = () => onChange(state);
  function dirty(text) {
    generation++;
    state.draft = text;
    state.status = text.trim() ? "dirty" : "empty";
    state.entries = [];
    state.errors = [];
    onDraft(text);
    notify();
  }
  async function search(text = state.draft, retry = false) {
    const previousErrors = state.errors;
    const token = ++generation;
    state.draft = text;
    state.status = "loading";
    if (!retry) state.errors = [];
    notify();
    try {
      const parsed = retry
        ? { entries: state.entries, errors: previousErrors }
        : await adapter.parse(text);
      if (token !== generation) return;
      state.entries = parsed.entries.map((e) => ({
        ...e,
        status: e.printing && retry ? "ready" : "loading",
      }));
      state.errors = parsed.errors || [];
      notify();
      const resolved = new Map();
      for (const entry of state.entries) {
        if (entry.status === "ready") continue;
        try {
          const identity = JSON.stringify([
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
      state.status =
        state.errors.length || state.entries.some((e) => e.status !== "ready")
          ? "error"
          : state.entries.length
            ? "ready"
            : "empty";
      if (state.status === "ready") {
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
    search,
    changePrinting,
    applyPrinting,
    canExport: () =>
      state.status === "ready" && !state.entries.some((e) => e.changing),
    cancel: () => generation++,
  };
}
module.exports = { createController };

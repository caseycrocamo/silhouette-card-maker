"use strict";
function createAdapter(game, request, options = {}) {
  let format = options.format || game.formats[0].id;
  let originalSource = "";
  let retainedInput = null;
  let retainedDraft = "";
  return {
    allowPartial: true,
    reimportOnRetry: true,
    setFormat(value) { if (format !== value) retainedInput = null; format = value; },
    clearSource() { retainedInput = null; },
    setInput(input) { retainedInput = input; retainedDraft = input.value; originalSource = input.value; },
    async parse(value) {
      const formatInfo = game.formats.find((item) => item.id === format);
      const kind = formatInfo?.inputKind || game.inputKind;
      const input = kind === 'file' && retainedInput && [retainedDraft, originalSource].includes(value)
        ? retainedInput
        : options.input ? await options.input(value, kind) : { kind, value };
      if (kind === 'file') { retainedInput = input; retainedDraft = value; }
      originalSource = input.kind === 'file' ? input.value : value;
      const result = await request({ op: "import", game: game.id, format, input, options: options.readOptions?.() || {} });
      const entries = (result.entries || []).map((e) => {
        const printing = { id: e.id, name: e.name, cacheId: e.cacheId, faces: e.faces, back: e.back };
        if (e.back?.url) printing.faces = [...(e.faces || []), { ...e.back, name: `${e.name} back` }];
        return { ...e, printing };
      });
      return { entries, warnings: result.warnings || [], errors: (result.errors || []).map((e) => ({ ...e, message: e.message })) };
    },
    resolve(entry) { return Promise.resolve(entry.printing); },
    serialize() { return originalSource; },
    exportPlan(entries, workflow = "front_only") {
      return entries.flatMap((e) => Array.from({ length: e.qty }, () => ({ name: e.name, front: { ...e.printing.faces[0], cacheId: e.printing.cacheId }, ...(workflow === "double_sided" && e.printing.back ? { back: e.printing.back } : {}) })));
    },
  };
}
module.exports = { createAdapter };

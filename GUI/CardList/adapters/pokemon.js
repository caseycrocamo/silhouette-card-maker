"use strict";
function createAdapter(request) {
  return {
    parse: (text) => request({ op: "parse", text }),
    resolve: (entry) => request({ op: "resolve", entry }),
    serialize: (entries) =>
      entries
        .map((e) => {
          const p = e.printing || e;
          return `${e.qty} ${e.name} ${p.setCode} ${p.number}`;
        })
        .join("\n"),
    exportPlan: (entries) =>
      entries.flatMap((e) =>
        Array.from({ length: e.qty }, () => ({
          name: e.name,
          front: { ...e.printing.faces[0], cacheId: e.printing.cacheId },
        })),
      ),
  };
}
module.exports = { createAdapter };

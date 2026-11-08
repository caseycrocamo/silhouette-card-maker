"use strict";
function createAdapter(fetcher = fetch) {
  async function json(url) {
    const response = await fetcher(url);
    if (!response.ok)
      throw new Error("Card lookup failed. Check the name and printing.");
    return response.json();
  }
  function normalize(data) {
    const faces = data.image_uris?.png
      ? [{ name: data.name, url: data.image_uris.png }]
      : (data.card_faces || [])
          .filter((f) => f.image_uris?.png)
          .map((f) => ({ name: f.name, url: f.image_uris.png }));
    if (!faces.length) throw new Error("No printable image is available.");
    return {
      id: data.id || `${data.set}:${data.collector_number}`,
      name: data.name,
      setCode: data.set?.toUpperCase() || "",
      number: data.collector_number || "",
      faces,
      paired: ["transform", "modal_dfc"].includes(data.layout),
      printsUrl: data.prints_search_uri,
      rawCard: data,
    };
  }
  return {
    parse(text) {
      const entries = [],
        errors = [];
      text.split(/\r?\n/).forEach((raw, index) => {
        let line = raw.trim();
        if (!line) return;
        let qty = 1;
        const count = line.match(/^(\d+)x?\s+/);
        if (count) {
          qty = Number(count[1]);
          line = line.slice(count[0].length);
        }
        const set = line.match(/\(([^)]+)\)(?:\s+(\S+))?/);
        let setCode = "",
          number = "";
        if (set) {
          setCode = set[1].trim();
          number = set[2] || "";
          line = line.replace(set[0], "").trim();
        }
        line = line.split(/\s*\[/)[0].trim();
        if (!line || !Number.isSafeInteger(qty) || qty < 1) {
          errors.push({
            line: index + 1,
            message: "Enter a card name and a positive quantity.",
          });
          return;
        }
        entries.push({
          id: `line-${index + 1}`,
          sourceLine: index + 1,
          name: line,
          qty,
          setCode,
          number,
        });
      });
      return { entries, errors };
    },
    async resolve(entry) {
      let url = "https://api.scryfall.com/cards/";
      if (entry.setCode && entry.number)
        url += `${encodeURIComponent(entry.setCode.toLowerCase())}/${encodeURIComponent(entry.number)}`;
      else
        url += `named?fuzzy=${encodeURIComponent(entry.name)}${entry.setCode ? "&set=" + encodeURIComponent(entry.setCode.toLowerCase()) : ""}`;
      return normalize(await json(url));
    },
    async printings(printing) {
      if (!printing.printsUrl) return [];
      const data = await json(printing.printsUrl);
      const sets = new Map();
      for (const p of data.data || []) {
        if (p.set && (p.image_uris || p.card_faces))
          sets.set(p.set, {
            id: p.set,
            label: `${p.set_name} [${p.set.toUpperCase()}]`,
            setCode: p.set,
          });
      }
      return [...sets.values()].sort((a, b) => a.label.localeCompare(b.label));
    },
    serialize(entries) {
      return entries
        .map((e) => {
          const p = e.printing || e;
          return `${e.qty > 1 ? e.qty + "x " : ""}${e.name}${p.setCode ? " (" + p.setCode + ")" : ""}${p.number ? " " + p.number : ""}`;
        })
        .join("\n");
    },
    exportPlan(entries, workflow) {
      return entries.flatMap((e) => {
        const p = e.printing;
        return Array.from({ length: e.qty }, () =>
          workflow === "double_sided" && p.paired && p.faces.length === 2
            ? [{ name: p.name, front: p.faces[0], back: p.faces[1] }]
            : p.faces.map((f) => ({ name: f.name || p.name, front: f })),
        ).flat();
      });
    },
    normalize,
  };
}
module.exports = { createAdapter };

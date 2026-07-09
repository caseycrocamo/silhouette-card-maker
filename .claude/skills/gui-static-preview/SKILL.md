---
name: gui-static-preview
description: Preview and verify CSS/HTML/layout/focus-state changes on this project's Electron GUI pages (anything under GUI/ — GUI/Home, GUI/Settings, GUI/CreatePDF, GUI/MagicTheGathering, GUI/Utilities) without launching the full Electron app via `npm start`. Use this whenever you're checking how a style, hover state, focus ring, or layout actually renders for a page under GUI/ — "does this look right", "check the focus outline", "verify this Tailwind change", "preview decklist.html" — it's far faster than booting Electron for anything purely visual. Do NOT use this for testing IPC calls, file-system operations, or other logic that depends on Electron/Node renderer APIs (require(), window.require, ipcRenderer, etc.) — those are unavailable in this static-file context and the skill will not help verify them; launch real Electron for that instead.
---

# GUI static preview (no Electron)

This project's `GUI/` folder is an Electron app, but its renderer pages are plain HTML/CSS/JS underneath. When a change is purely visual — a Tailwind class, a layout tweak, a focus/hover state — you don't need Electron's overhead (native window, IPC bridge, `npm start` boot time) just to look at it. Serving `GUI/` as static files and opening the page in the Claude Preview browser tools is a full browser with real CSS/layout/focus behavior, and it starts in about a second.

Trade-off: renderer scripts assume Node (`require(...)`), so this only proves out markup and CSS, not the page's own JS-driven behavior. See "What this can't verify" below for where to stop and launch real Electron instead.

## 1. Make sure the static server is configured

Check `.claude/launch.json` for a configuration named `gui-static`. If the file or that entry doesn't exist yet, add it — **merge into any existing configurations array, don't overwrite it**, other configs may already be defined there. Resolve the repo's absolute path dynamically (e.g. `git rev-parse --show-toplevel`) rather than hardcoding a path, since whoever runs this may have the repo checked out somewhere else:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "gui-static",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "4173", "--directory", "<absolute-path-to-repo>/GUI"],
      "port": 4173
    }
  ]
}
```

## 2. Start it and open the page

Use `mcp__Claude_Preview__preview_start` with name `gui-static`. Then navigate (via `preview_eval`, e.g. `location.href = 'http://localhost:4173/<Section>/<page>.html'`) to the specific renderer page you're checking, e.g. `http://localhost:4173/MagicTheGathering/decklist.html`. Every page under `GUI/` (`Home/`, `Settings/`, `CreatePDF/`, `MagicTheGathering/`, `Utilities/`) is reachable the same way, relative to `GUI/` as the server root — so links between pages using `../` (like `../styles/main.css`, `../shared/navbar.js`) resolve correctly too.

## 3. Expect (and ignore) the `require` error

Renderer scripts loaded via `<script type="module" src="....js">` commonly start with a top-level `require('../shared/...')`, because in real Electron these renderers run with Node integration. Outside Electron there's no `require`, so the module throws `ReferenceError: require is not defined` immediately on load. That's expected — check `preview_console_logs` if you want to confirm it's *only* that error and nothing else unexpected. It means that script's own logic (event listeners, dynamic DOM updates) never runs, but the static markup and all CSS — including Tailwind's `:hover`/`:focus`/`:checked` states — render and behave completely normally, because those are handled by the browser, not by the page's JS. That's exactly what this skill is for: verifying appearance, not behavior.

## 4. If you changed Tailwind classes, rebuild the CSS first

`GUI/styles/main.css` is a **generated file** (gitignored), built from `GUI/styles/tailwind.css` by scanning the templates for class names. If you added or edited a Tailwind class in any HTML — especially an arbitrary-value class like `checked:border-[5px]` that isn't already used elsewhere in the project — it will not exist in `main.css` until you rebuild, and will silently have zero effect (no error, the class is just absent from the compiled CSS). Run this before previewing:

```bash
cd GUI && npm run build:css
```

If a style change doesn't seem to take effect, this is the first thing to check — confirm the class actually landed in `main.css` (`grep` for it) before assuming the HTML/logic is wrong.

## 5. Verifying the change

Two tools do most of the work:

- **`preview_eval` + `getComputedStyle`** — the precise way to check a style actually resolved the way you expect (exact `border-radius`, `box-shadow`, `outline`, etc.), rather than eyeballing a screenshot. Also useful for enumerating which CSS rule actually won a cascade, if a class doesn't seem to apply (see reference script pattern below).
- **`preview_click`** — for anything gated behind `:focus`, `:hover`, or `:checked`, trigger it with a real interaction, not a JS shortcut. Calling `element.focus()` directly through `preview_eval` does move `document.activeElement` correctly, but did not reliably trigger `:focus`-driven `box-shadow`/ring rendering in this preview browser during testing — it looked unfocused even though it wasn't. A real `preview_click` on the element (or on a `<label>` that wraps it, to test label-forwarded focus) reliably triggers the full `:focus` styling. When in doubt, prefer a real click over a synthetic focus call.

`preview_screenshot` is a good sanity check afterward, but computed-style checks are the ground truth — screenshots compress small details (a few px of border-radius is hard to eyeball at 16x16).

If you need to figure out *why* a style isn't applying (e.g. computed value doesn't match any rule you can find), this pattern finds every CSS rule in the page actually matching an element, which is more reliable than guessing at specificity by hand:

```js
(() => {
  const el = document.querySelector('SELECTOR');
  const results = [];
  function walk(rules) {
    for (const rule of rules) {
      if (rule.style && rule.selectorText) {
        try { if (el.matches(rule.selectorText)) results.push({ selector: rule.selectorText, cssText: rule.style.cssText }); } catch(e) {}
      }
      if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
    }
  }
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch(e) {} }
  return results;
})()
```

Don't gate the recursion on a plain `if (rule.cssRules)` truthiness check and `continue` — in this preview browser, *every* `CSSStyleRule` has a `.cssRules` property (an empty `CSSRuleList`, not `undefined`), not just `@media`/`@supports` blocks, because CSS Nesting gives ordinary style rules a home for nested children too. A truthy check on it treats every single rule as a container and skips checking its own selector, so the scan silently returns nothing. Check `rule.style && rule.selectorText` unconditionally first, and separately recurse only when `rule.cssRules.length` is actually non-zero.

## 6. Clean up

Remove any `<style>`/`<script>` tags you injected into the live page for testing (harmless since a reload clears them, but don't let the habit bleed into leaving cruft in actual source files), and stop the server with `preview_stop` when you're done.

## What this can't verify

Anything that depends on the page's own JS actually running: form submission handlers, IPC calls to the Electron main process, `sessionStorage`/`fs` access via `window.require`, dynamic content populated by a `window.onload` handler, etc. For that, launch the real app (`npm start` in `GUI/`, or `npm run dev` to rebuild CSS first) — this skill is specifically the fast path for the subset of changes that are pure CSS/markup.

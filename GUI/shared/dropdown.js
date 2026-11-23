"use strict";

const { createButton } = require("./button");

// Keep the menu in the dialog's top layer, with its center on the control.
function createDropdown({ id, labelledBy, choices, value }, doc = document) {
  const win = doc.defaultView;
  const control = createButton({ id }, doc);
  control.classList.add("paper-button--dropdown");
  control.setAttribute("role", "combobox");
  control.setAttribute("aria-haspopup", "listbox");
  control.setAttribute("aria-expanded", "false");
  control.setAttribute("aria-labelledby", labelledBy);
  const caption = doc.createElement("span");
  control.append(caption);
  const menu = doc.createElement("div");
  menu.id = id + "-menu";
  menu.className = "paper-dropdown-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-labelledby", labelledBy);
  menu.hidden = true;
  control.setAttribute("aria-controls", menu.id);
  let selected = choices.some(item => item.id === value) ? value : choices[0]?.id || "";
  let active = 0;
  let search = "", searchedAt = 0;
  const options = choices.map((item, index) => {
    const option = doc.createElement("div");
    option.id = `${id}-option-${index}`;
    option.className = "paper-dropdown-option";
    option.setAttribute("role", "option");
    option.textContent = item.label;
    option.addEventListener("pointermove", () => activate(index));
    option.addEventListener("pointerdown", event => event.preventDefault());
    option.addEventListener("click", event => {
      event.preventDefault();
      choose(index);
    });
    menu.append(option);
    return option;
  });
  function sync() {
    caption.textContent = choices.find(item => item.id === selected)?.label || "";
    options.forEach((option, index) => option.setAttribute("aria-selected", String(choices[index].id === selected)));
  }
  Object.defineProperty(control, "value", {
    get: () => selected,
    set: next => { selected = choices.some(item => item.id === next) ? next : ""; sync(); },
  });
  function position() {
    const rect = control.getBoundingClientRect();
    const width = Math.min(rect.width, win.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, win.innerWidth - width - 8))}px`;
    const below = win.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < Math.min(menu.scrollHeight, 240) && above > below;
    menu.style.maxHeight = `${Math.max(0, Math.min(320, upward ? above : below))}px`;
    menu.style.top = `${upward ? rect.top - menu.offsetHeight - 4 : rect.bottom + 4}px`;
  }
  function activate(index) {
    active = index;
    options.forEach((option, i) => option.classList.toggle("is-active", i === active));
    control.setAttribute("aria-activedescendant", options[active].id);
    options[active].scrollIntoView({ block: "nearest" });
  }
  function outside(event) { if (!control.contains(event.target) && !menu.contains(event.target)) close(); }
  function scroll(event) { if (!menu.contains(event.target)) close(); }
  function close() {
    menu.hidden = true;
    control.setAttribute("aria-expanded", "false");
    control.removeAttribute("aria-activedescendant");
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("scroll", scroll, true);
    win.removeEventListener("resize", close);
  }
  function open() {
    if (control.disabled || !choices.length) return;
    (control.closest("dialog") || doc.body).append(menu);
    menu.hidden = false;
    control.setAttribute("aria-expanded", "true");
    position();
    activate(Math.max(0, choices.findIndex(item => item.id === selected)));
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("scroll", scroll, true);
    win.addEventListener("resize", close);
  }
  function choose(index) {
    const changed = selected !== choices[index].id;
    control.value = choices[index].id;
    close();
    control.focus();
    if (changed) control.dispatchEvent(new win.Event("change", { bubbles: true }));
  }
  control.addEventListener("click", () => menu.hidden ? open() : close());
  control.addEventListener("blur", close);
  control.addEventListener("keydown", event => {
    if (event.key === "Tab") { close(); return; }
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const wasClosed = menu.hidden;
      if (wasClosed) open();
      if (event.key === "Home") activate(0);
      else if (event.key === "End") activate(choices.length - 1);
      else if (!wasClosed) activate((active + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (menu.hidden) open(); else choose(active);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      search = (now - searchedAt < 700 ? search : "") + event.key.toLowerCase();
      searchedAt = now;
      if (menu.hidden) open();
      const index = choices.findIndex(item => item.label.toLowerCase().startsWith(search));
      if (index >= 0) activate(index);
    }
  });
  sync();
  return { control, destroy() { close(); menu.remove(); } };
}

module.exports = { createDropdown };

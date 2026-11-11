"use strict";
const { app, BrowserWindow, ipcMain, session, dialog } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, ".."), work = fs.mkdtempSync(path.join(os.tmpdir(), "game-picker-"));
const constants = require("../GUI/shared/constants");
for (const [getter, name] of Object.entries({ getFrontDir: "front", getDoubleSidedDir: "double", getDataDir: "data", getBackDir: "back", getOutputDir: "output", getDecklistDir: "decklist" })) {
  const directory = path.join(work, name); fs.mkdirSync(directory, { recursive: true }); constants[getter] = () => directory;
}
const cache = path.join(constants.getDataDir(), "card-cache"); fs.mkdirSync(cache);
const ids = { front: "a".repeat(32), back: "b".repeat(32) };
for (const id of Object.values(ids)) fs.copyFileSync(path.join(root, "test/images/1_mtg.png"), path.join(cache, id + ".png"));
let win, lotrImports = 0;
const errors = [], requests = [];
const js = code => win.webContents.executeJavaScript(code);
async function wait(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw Error(message + ": " + errors.join(" | ") + " | " + await js("document.body.innerText"));
}
async function home() { await win.loadFile(path.join(root, "GUI/Home/home.html")); await wait(() => js("document.querySelectorAll('#gamePicker button').length===22"), "Game grid"); }
async function choose(game) { await js(`document.querySelector('[data-game=${game}]').click()`); }
async function field(id) { await wait(() => js(`!!document.getElementById(${JSON.stringify(id)})`), id); }
async function set(id, value) { await js(`(() => {const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function proceed() { await js("document.getElementById('gameOptionsContinue').click()"); }
async function cardList(game) { await wait(() => js(`location.search.includes('game=${game}') && !document.getElementById('longText')?.disabled`), "Card list ready"); }
async function search(text) {
  await js(`document.getElementById('longText').value=${JSON.stringify(text)};document.getElementById('longText').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('longForm').requestSubmit()`);
  await wait(() => js("!document.getElementById('nextCreatePdfBtn').disabled"), "Search result");
}
async function options() { await js("document.getElementById('gameOptionsBtn').click()"); await field("gameOptionsContinue"); await wait(() => js("!document.getElementById('gameOptionsContinue').disabled"), "Options ready"); }
async function cancel() { await js("document.getElementById('gameOptionsDialog').dispatchEvent(new Event('cancel',{cancelable:true}))"); }
async function screenshot(name) {
  await js("new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  fs.writeFileSync(path.join(work, name + ".png"), (await win.webContents.capturePage()).toPNG());
}
async function run() {
  app.commandLine.appendSwitch("disable-gpu"); app.setPath("userData", path.join(work, "electron")); await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, cb) => cb({ cancel: true }));
  require("../GUI/Utilities/cardWorkerClient").requestCards = async payload => {
    requests.push(payload);
    if (payload.op === "capabilities") {
      throw Error("The options popup must not start or wait for the card worker.");
    }
    if (payload.op === "import") {
      const lotr = payload.game === "lotr_lcg", partial = lotr && lotrImports++ === 0;
      return { status: partial ? "partial" : "success", errors: partial ? [{ message: "One card failed" }] : [], entries: [{ id: "card-1", name: lotr ? "Test player card" : "Test Ashes card", qty: 1, cacheId: ids.front, faces: [{ url: pathToFileURL(path.join(cache, ids.front + ".png")).href }], ...(lotr ? { back: { cacheId: ids.back, url: pathToFileURL(path.join(cache, ids.back + ".png")).href } } : {}) }] };
    }
    return { released: 0 };
  };
  require("../GUI/Utilities/ipcHandlers");
  ipcMain.handle("updates:get-state", () => ({ status: "idle" }));
  dialog.showMessageBox = async () => ({ response: 2 });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(work, "back")] });
  win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  win.webContents.on("console-message", (_event, level, message) => { if (level === 3) errors.push(message); });
  await home();
  assert.equal(await js("[...document.querySelectorAll('#gamePicker button')].every(button=>button.classList.contains('paper-button'))"), true);
  assert.equal(await js("document.querySelector('#gamePicker [data-game=mtg]').textContent"), "Magic: The Gathering");
  assert.equal(await js("document.querySelector('#gamePicker [data-game=pokemon]').textContent"), "Pokémon");
  assert.equal(await js("document.querySelectorAll('#gamePicker a').length"), 0);
  await screenshot("game-grid");
  await choose("mtg"); await field("game-option-mode");
  assert.equal(await js("!!document.activeElement.closest('dialog')"), true);
  await screenshot("mtg-options");
  await cancel();
  assert.equal(await js("document.activeElement.dataset.game"), "mtg");
  assert.equal(await js("document.querySelector('dialog')"), null);
  await choose("mtg"); await field("game-option-mode"); await set("game-option-mode", "translation");
  assert.equal(await js("document.getElementById('game-option-workflow').parentElement.parentElement.hidden"), true);
  await proceed();
  await wait(() => win.webContents.getURL().includes("text_translation.html") && !win.webContents.isLoading(), "Translation route");
  await home(); await choose("pokemon"); await cardList("pokemon");
  assert.equal(await js("document.querySelector('dialog')"), null);
  assert.equal(await js("document.querySelectorAll('#longForm select').length"), 0);
  await home();
  const optionsStarted = Date.now();
  await choose("ashes_reborn");
  await field("game-option-format");
  const optionsElapsed = Date.now() - optionsStarted;
  assert.ok(optionsElapsed < 1000, `Options took ${optionsElapsed} ms without a card worker.`);
  assert.equal(requests.length, 0, "Choosing games should not call the card worker.");
  console.log(`Options ready in ${optionsElapsed} ms without starting Python.`);
  await set("game-option-format", "ashesdb_share_url"); await set("game-option-source", "ashesdb");
  await cancel();
  assert.equal(await js("sessionStorage.getItem('card-list:v1:ashes_reborn:selection')"), null);
  await choose("ashes_reborn"); await field("game-option-format");
  await set("game-option-format", "ashesdb_share_url"); await set("game-option-source", "ashesdb");
  await win.setSize(375, 900);
  assert.equal(await js("document.querySelector('dialog').getBoundingClientRect().width <= innerWidth"), true);
  await win.setSize(1440, 1100); await screenshot("import-options"); await proceed(); await cardList("ashes_reborn");
  assert.equal(await js("document.querySelectorAll('#longForm select').length"), 0);
  assert.equal(await js("document.getElementById('workflow')"), null);
  const source = "https://ashes.example/deck/123";
  await search(source);
  let imported = requests.findLast(item => item.op === "import");
  assert.equal(imported.format, "ashesdb_share_url"); assert.equal(imported.options.source, "ashesdb");
  assert.equal(await js("document.getElementById('longText').value"), source);
  await screenshot("simple-card-list");
  await options(); await set("game-option-source", "ashes"); await cancel();
  assert.equal(await js("document.getElementById('nextCreatePdfBtn').disabled"), false);
  assert.match(await js("document.getElementById('gameOptionsSummary').textContent"), /ashesdb/i);
  await options(); await set("game-option-format", "ashes_share_url"); await proceed();
  assert.equal(await js("document.getElementById('longText').value"), "");
  assert.equal(await js("document.getElementById('nextCreatePdfBtn').disabled"), true);
  await options(); await set("game-option-format", "ashesdb_share_url"); await proceed();
  assert.equal(await js("document.getElementById('longText').value"), source);
  await home(); await choose("lotr_lcg"); await field("game-option-scenario");
  await set("game-option-scenario", "easy"); await set("game-option-workflow", "double_sided");
  await js("[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Choose folder').click()");
  await wait(() => js("document.querySelector('dialog').innerText.includes('" + work.replaceAll("\\", "\\\\") + "')"), "Local back folder");
  await proceed(); await cardList("lotr_lcg"); await search("123");
  await js("[...document.querySelectorAll('#output button')].find(button=>button.textContent==='Retry import').click()");
  await wait(() => js("!document.body.innerText.includes('One card failed') && !document.getElementById('nextCreatePdfBtn').disabled"), "Retry import");
  const lookupsBeforeWorkflow = requests.filter(item => item.op === "import").length;
  await options(); await set("game-option-workflow", "front_only"); await proceed();
  assert.equal(await js("document.getElementById('nextCreatePdfBtn').disabled"), false);
  await options(); await set("game-option-workflow", "double_sided"); await proceed();
  assert.equal(requests.filter(item => item.op === "import").length, lookupsBeforeWorkflow);
  imported = requests.findLast(item => item.op === "import");
  assert.equal(imported.options.scenario, "easy"); assert.equal(imported.options.localBackDir, path.join(work, "back"));
  await js("[...document.querySelectorAll('#output button')].find(button=>button.textContent==='Flip card').click()");
  assert.ok((await js("document.querySelector('#output img').src")).includes(ids.back));
  await js("document.getElementById('nextCreatePdfBtn').click()");
  await wait(() => win.webContents.getURL().includes("/CreatePDF/") && !win.webContents.isLoading(), "PDF route");
  assert.equal(fs.readdirSync(constants.getFrontDir()).filter(name => name.endsWith(".png")).length, 1);
  assert.equal(fs.readdirSync(constants.getDoubleSidedDir()).filter(name => name.endsWith(".png")).length, 1);
  assert.equal(await js("sessionStorage.getItem('onlyFronts')"), "false");
  assert.ok(!errors.some(message => message.includes("Uncaught")), errors.join("\n"));
  console.log("Game picker and options popup smoke passed. Artifacts: " + work);
  win.destroy(); app.quit();
}
run().catch(error => { console.error(error); if (win) win.destroy(); app.exit(1); });

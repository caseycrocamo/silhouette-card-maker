'use strict';

// Run one case in a fresh Electron process. Docker runs each case in a fresh
// container so the production filesystem paths and PDF worker stay realistic.
const CASES = ['navigation', 'create-pdf', 'settings', 'translation', 'decklist', 'decklist-printing', 'pdf-viewer'];
if (process.argv.includes('--list')) {
  process.stdout.write(`${JSON.stringify(CASES)}\n`);
  process.exit(0);
}

const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const gui = path.join(root, 'GUI');
const caseName = process.argv.find(argument => CASES.includes(argument));
const errors = [];
const alerts = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7Z8AAAAASUVORK5CYII=', 'base64');
let win;
let chosenFiles = [];
let chosenPdf = null;
let exitStarted = false;

function assert(value, message) { if (!value) throw new Error(message); }
function wait(ms = 200) { return new Promise(resolve => setTimeout(resolve, ms)); }
function outputDir() { return path.join(root, 'game', 'output'); }
function frontDir() { return path.join(root, 'game', 'front'); }
function doubleDir() { return path.join(root, 'game', 'double_sided'); }
function backDir() { return path.join(root, 'game', 'back'); }
function ensureDirs() {
  for (const dir of [outputDir(), frontDir(), doubleDir(), backDir(), path.join(root, 'game', 'decklist')]) fs.mkdirSync(dir, { recursive: true });
}
async function load(rel) {
  errors.length = 0;
  const [page, query] = rel.split('?');
  await win.loadFile(path.join(gui, page), query ? { query: Object.fromEntries(new URLSearchParams(query)) } : undefined);
  await wait(300);
  await js("window.alert = value => window.__lastAlert = String(value); window.confirm = () => false; window.__uiErrors = []; window.addEventListener('error', e => window.__uiErrors.push(e.message)); window.addEventListener('unhandledrejection', e => window.__uiErrors.push(String(e.reason)))");
  assert(errors.length === 0, `Renderer errors on ${rel}: ${errors.join('\n')}`);
}
async function js(code) { return win.webContents.executeJavaScript(code); }
async function click(id) { await js(`document.getElementById(${JSON.stringify(id)}).click()`); }
async function waitFor(fn, message, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await wait(100); }
  throw new Error(message);
}
function verifyPdf(file) {
  assert(fs.existsSync(file), `Expected PDF file: ${file}`);
  const bytes = fs.readFileSync(file);
  assert(bytes.subarray(0, 5).toString() === '%PDF-', `Invalid PDF header: ${file}`);
  assert(bytes.length > 500, `PDF is unexpectedly small: ${bytes.length} bytes`);
  const inspected = spawnSync('python', ['-c', 'import json,sys,pypdfium2 as p; d=p.PdfDocument(sys.argv[1]); print(json.dumps({"pages":len(d),"width":d[0].get_width(),"height":d[0].get_height()}))', file], { encoding: 'utf8' });
  assert(inspected.status === 0, `PDF parser failed: ${inspected.stderr || inspected.stdout}`);
  const info = JSON.parse(inspected.stdout.trim());
  assert(info.pages > 0 && info.width > 0 && info.height > 0, `PDF has no valid pages: ${JSON.stringify(info)}`);
}
function seedFront(name = 'fixture.png') { fs.writeFileSync(path.join(frontDir(), name), png); }

async function navigation() {
  await load('Home/home.html');
  assert(await js("document.querySelector('h1')?.textContent.includes('Welcome')"), 'Home heading missing');
  assert(await js("Boolean(document.getElementById('calibrationNotice') && !document.getElementById('calibrationNotice').classList.contains('hidden'))"), 'Fresh-install calibration notice missing');
  await js("require('electron').shell.openExternal = url => { window.__openedExternal = url; return Promise.resolve(); }; void 0");
  await click('calibrationDocsLink');
  assert(await js("window.__openedExternal === document.getElementById('calibrationDocsLink').href"), 'Calibration guide action did not use the external-link handler');
  await js("Array.from(document.querySelectorAll('#calibrationNotice button')).find(b => b.textContent.includes('Go to Settings')).click()");
  await waitFor(async () => (await js('location.pathname')).endsWith('/Settings/settings.html'), 'Home calibration Settings action failed');
  assert(await js("Boolean(document.getElementById('editXOffset') && document.getElementById('saveOffsetBtn'))"), 'Calibration Settings page did not load');
  await load('Home/home.html');
  await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Magic the Gathering')).click()");
  await waitFor(async () => (await js('location.pathname')).endsWith('/MagicTheGathering/decklist.html'), 'Home MTG navigation failed');
  assert(await js("Boolean(document.getElementById('searchBtn') && document.getElementById('exportBtn') && document.getElementById('nextCreatePdfBtn'))"), 'Decklist controls did not load');
  await js("Array.from(document.querySelectorAll('input[name=cardWorkflow]')).find(x => x.value === 'front_only').click()");
  assert(await js("sessionStorage.getItem('cardWorkflow') === 'front_only'"), 'Workflow toggle did not persist');
  await js("Array.from(document.querySelectorAll('nav-bar nav a')).find(a => a.getAttribute('href') === '../Home/home.html').click()");
  await waitFor(async () => (await js('location.pathname')).endsWith('/Home/home.html'), 'Navbar Choose Game link failed');
  await js("Array.from(document.querySelectorAll('nav-bar nav a')).find(a => a.getAttribute('href') === '../MagicTheGathering/decklist.html').click()");
  await waitFor(async () => (await js('location.pathname')).endsWith('/MagicTheGathering/decklist.html'), 'Navbar Card List link failed');
  assert(await js("Boolean(document.getElementById('longText') && document.getElementById('searchBtn'))"), 'Navbar Card List destination did not load');
  await js("Array.from(document.querySelectorAll('nav-bar nav a')).find(a => a.getAttribute('href') === '../CreatePDF/create.html').click()");
  await waitFor(async () => (await js('location.pathname')).endsWith('/CreatePDF/create.html'), 'Navbar Create PDF link failed');
  assert(await js("Boolean(document.getElementById('createPdfBtn') && document.getElementById('pdfArgs'))"), 'Navbar Create PDF destination did not load');
  await js("document.querySelector('nav-bar a[title=Settings]').click()");
  await waitFor(async () => (await js('location.pathname')).endsWith('/Settings/settings.html'), 'Navbar Settings link failed');
  assert(await js("Boolean(document.getElementById('saveOffsetBtn') && document.getElementById('runOffsetPdfBtn'))"), 'Navbar Settings destination did not load');
  await load('Home/home.html');
  await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('MTG Text Translation')).click()");
  await waitFor(async () => (await js('location.pathname')).endsWith('/MagicTheGathering/text_translation.html'), 'Home translation navigation failed');
  assert(await js("['mdText','paperSize','ppi','quality','generatePdfBtn'].every(id => document.getElementById(id))"), 'Translation controls missing');
}

async function createPdf() {
  ensureDirs();
  seedFront();
  const fixture = path.join(root, 'game', 'fixture.png');
  fs.writeFileSync(fixture, png);
  chosenFiles = [fixture];
  await load('CreatePDF/create.html');
  assert(await js("document.querySelector('#frontImagesGrid img')?.alt === 'fixture.png'"), 'Front image did not render');
  await click('uploadDoubleSidedBtn');
  await waitFor(async () => fs.existsSync(path.join(doubleDir(), 'fixture.png')), 'Double-sided image import failed');
  assert(await js("document.querySelector('#doubleSidedImagesGrid img')?.alt === 'fixture.png'"), 'Imported image did not render');
  await click('clearDoubleSidedBtn');
  await waitFor(async () => !fs.existsSync(path.join(doubleDir(), 'fixture.png')), 'Double-sided image delete failed');
  chosenFiles = [path.join(root, 'missing-fixture.png')];
  await click('uploadBackBtn');
  await waitFor(async () => (await js('window.__lastAlert || ""')).includes('Error uploading back image'), 'Invalid image selection did not show an error');
  assert(!fs.existsSync(path.join(backDir(), 'back.png')), 'Invalid image selection created a back image');
  chosenFiles = [fixture];
  await click('uploadBackBtn');
  await waitFor(async () => fs.existsSync(path.join(backDir(), 'back.png')), 'Back image import failed');
  assert(await js("document.querySelector('#backImagePreview img')?.alt === 'back.png'"), 'Back preview did not render');
  await click('clearBackBtn');
  await waitFor(async () => !fs.existsSync(path.join(backDir(), 'back.png')), 'Back image delete failed');
  await js("document.getElementById('skip4Checkbox').click(); document.getElementById('loadOffsetCheckbox').click(); document.getElementById('onlyFrontsCheckbox').click()");
  const toggles = await js("({args:document.getElementById('pdfArgs').value, doubleHidden:document.getElementById('doubleSidedSection').classList.contains('hidden'), backHidden:document.getElementById('backImageSection').classList.contains('hidden')})");
  assert(toggles.args.includes('--skip 4') && toggles.args.includes('--load_offset') && toggles.args.includes('--only_fronts'), 'PDF option toggles did not update arguments');
  assert(toggles.doubleHidden && toggles.backHidden, 'Only-front workflow did not hide back-side options');
  await js(`document.getElementById('pdfArgs').value=${JSON.stringify(`--output_path ${path.join(outputDir(), 'ui-create.pdf')}`)}`);
  await click('createPdfBtn');
  await waitFor(async () => (await js('location.pathname')).endsWith('/Utilities/pdf_viewer.html'), 'Create PDF did not open viewer', 30000);
  verifyPdf(path.join(outputDir(), 'ui-create.pdf'));
  await waitFor(async () => (await js("document.getElementById('pdfFrame').src")).includes('ui-create.pdf'), 'Viewer did not select generated PDF');
  // Exercise the real empty-image validation and confirm the page remains usable.
  await load('CreatePDF/create.html');
  await click('clearFrontBtn');
  await click('createPdfBtn');
  await waitFor(async () => (await js('window.__lastAlert || ""')).includes('Error creating PDF'), 'Empty image submission did not report an error');
  seedFront();
  await js("document.getElementById('pdfArgs').value='--unsupported-option'");
  await click('createPdfBtn');
  await waitFor(async () => (await js('window.__lastAlert || ""')).includes('Error creating PDF'), 'Invalid PDF argument did not report an error');
}

async function settings() {
  ensureDirs();
  await load('Settings/settings.html');
  assert(await js("Boolean(document.getElementById('editXOffset') && document.getElementById('editYOffset') && document.getElementById('runOffsetPdfBtn'))"), 'Offset settings controls missing');
  const defaultPdf = await js("document.getElementById('offsetPdfPath').value");
  assert(defaultPdf === path.join(root, 'calibration', 'letter-calibration.pdf') && fs.existsSync(defaultPdf), `Default calibration PDF is invalid: ${defaultPdf}`);
  await js("document.getElementById('offsetPdfPath').value='retain-this.pdf'");
  await click('browsePdfBtn');
  assert(await js("document.getElementById('offsetPdfPath').value === 'retain-this.pdf'"), 'Cancelled PDF browse changed the selected path');
  await js("document.getElementById('editXOffset').value='not-a-number'; document.getElementById('editYOffset').value='bad'");
  await click('saveOffsetBtn');
  const offsetsPath = path.join(root, 'data', 'offset_data.json');
  await waitFor(async () => fs.existsSync(offsetsPath) && (() => { const data = JSON.parse(fs.readFileSync(offsetsPath, 'utf8')); return data.x_offset === 0 && data.y_offset === 0; })(), 'Invalid offsets did not recover to zero');
  await js("document.getElementById('editXOffset').value='2.25'; document.getElementById('editYOffset').value='-1.5'");
  await js('window.alert = value => window.__lastAlert = String(value); void 0');
  await click('saveOffsetBtn');
  await waitFor(async () => JSON.parse(fs.readFileSync(path.join(root, 'data', 'offset_data.json'), 'utf8')).x_offset === 2.25, 'Offset values were not saved');
  assert(await js("window.__lastAlert === 'Offset data saved.'"), 'Save confirmation missing');
  const pdf = path.join(outputDir(), 'offset-source.pdf');
  const source = path.join(root, 'calibration', 'letter-calibration.pdf');
  assert(fs.existsSync(source), 'Calibration PDF fixture missing');
  fs.copyFileSync(source, pdf);
  await js(`document.getElementById('offsetPdfPath').value=${JSON.stringify(pdf)}`);
  await click('runOffsetPdfBtn');
  await waitFor(async () => (await js('location.pathname')).endsWith('/Utilities/pdf_viewer.html'), 'Offset operation did not open viewer', 30000);
  const viewerPath = new URLSearchParams(await js('location.search').then(s => s.slice(1))).get('path');
  assert(viewerPath && fs.existsSync(viewerPath), 'Offset PDF output missing');
  verifyPdf(viewerPath);
  await load('Settings/settings.html');
  await js("document.getElementById('offsetPdfPath').value='/tmp/does-not-exist.pdf'; window.alert = value => window.__lastAlert = String(value); void 0");
  await click('runOffsetPdfBtn');
  await waitFor(async () => /Cannot offset nonexistent PDF|does not exist/i.test(await js('window.__lastAlert || ""')), 'Missing-PDF error was not shown');
  assert((await js('location.pathname')).endsWith('/Settings/settings.html'), 'Missing PDF selection navigated away from settings');
  assert(await js("!document.getElementById('sharedLoadingOverlay') || document.getElementById('sharedLoadingOverlay').classList.contains('hidden')"), 'Loading overlay remained after a failed offset run');
}

async function translation() {
  ensureDirs();
  await load('MagicTheGathering/text_translation.html');
  await js("window.alert = value => window.__lastAlert = String(value); void 0");
  await js("document.getElementById('generatePdfBtn').click()" );
  assert(await js("window.__lastAlert.includes('Please paste markdown')"), 'Empty markdown validation missing');
  await js("document.getElementById('mdText').value='### Test Card {1}{U}\\n\\n*Creature*\\n\\nDraw a card.'; document.getElementById('ppi').value='0'");
  await js("document.getElementById('mdForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert(await js("window.__lastAlert.includes('PPI must')"), 'Invalid PPI validation missing');
  await js("document.getElementById('ppi').value='300'; document.getElementById('quality').value='101'");
  await js("document.getElementById('mdForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert(await js("window.__lastAlert.includes('Quality must')"), 'Invalid quality validation missing');
  await js("document.getElementById('quality').value='75'; document.getElementById('paperSize').value='a4'");
  await js("document.getElementById('mdForm').dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}))");
  const translationPdf = path.join(outputDir(), 'translatedTextBoxes.pdf');
  await waitFor(async () => {
    if (!fs.existsSync(translationPdf)) return false;
    const partial = fs.readFileSync(translationPdf);
    return partial.subarray(0, 5).toString() === '%PDF-' && partial.length > 500;
  }, 'Translation PDF was not generated', 45000);
  verifyPdf(translationPdf);
  await waitFor(async () => (await js('location.pathname')).endsWith('/Utilities/pdf_viewer.html'), 'Translation did not open viewer', 20000);
}

async function decklist() {
  ensureDirs();
  const fixtureUrl = 'https://fixture.local/card.png';
  const card = { name: 'Test Card', layout: 'normal', image_uris: { png: fixtureUrl }, set: 'tst', collector_number: '1' };
  await load('MagicTheGathering/decklist.html');
  await js(`window.fetch = async url => String(url).includes('api.scryfall.com') ? (String(url).includes('Missing') ? ({ok:false,status:404}) : ({ok:true,json:async()=>(${JSON.stringify(card)})})) : ({ok:true,arrayBuffer:async()=>Uint8Array.from(atob(${JSON.stringify(png.toString('base64'))}), c=>c.charCodeAt(0)).buffer}); void 0`);
  await js("document.getElementById('longText').value='Missing Card'; document.getElementById('longForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitFor(async () => (await js("document.getElementById('output').innerText")).includes('Card not found'), 'Unknown card error was not rendered');
  await js("document.getElementById('longText').value='2x Test Card (tst) 1'; document.getElementById('longForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitFor(async () => (await js("document.querySelectorAll('#output img').length")) > 0, 'Decklist search returned no card image', 10000);
  const result = await js("({text:document.getElementById('output').innerText, inputs:document.querySelectorAll('#output input').length})");
  assert(result.text.includes('Test Card') && result.inputs === 0, 'Parsed card name missing from results');
  // Preserve a single result card for a deterministic, local export and test workflow toggle.
  await js("document.getElementById('longText').value='Test Card'; document.getElementById('longForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitFor(async () => (await js("document.querySelectorAll('#output img').length")) > 0, 'Single-card search did not complete', 10000);
  // Search buttons select matching printings; trigger the first result action.
  await js("document.querySelector('#output button')?.click()");
  await wait(200);
  // Tests parser and workflow persistence even if the mock result renderer varies.
  await js("document.querySelector('input[value=front_only]').click(); document.getElementById('longText').value='Test Card';");
  await click('nextCreatePdfBtn');
  await waitFor(async () => (await js('location.pathname')).endsWith('/CreatePDF/create.html'), 'Decklist next-step navigation failed', 10000);
  assert(await js("sessionStorage.getItem('onlyFronts') === 'true'"), 'Front-only workflow did not reach PDF page');
}

async function decklistPrinting() {
  const fixtures = {
    alpha: { name: 'Test Card', layout: 'normal', set: 'aaa', collector_number: '1', image_uris: { png: 'https://fixture.local/alpha.png' }, prints_search_uri: 'https://fixture.local/prints' },
    beta: { name: 'Test Card', layout: 'normal', set: 'bbb', collector_number: '27', image_uris: { png: 'https://fixture.local/beta.png' }, prints_search_uri: 'https://fixture.local/prints' },
    gamma: { name: 'Test Card', layout: 'normal', set: 'ccc', collector_number: '5', image_uris: { png: 'https://fixture.local/gamma.png' }, prints_search_uri: 'https://fixture.local/prints' }
  };
  await load('MagicTheGathering/decklist.html');
  await js(`window.fetch = async url => {
    url=String(url);
    if(url.endsWith('/prints')) return {ok:true,json:async()=>({data:[
      {set:'aaa',set_name:'Alpha Set',image_uris:{png:'https://fixture.local/alpha.png'}},
      {set:'bbb',set_name:'Beta Set',image_uris:{png:'https://fixture.local/beta.png'}},
      {set:'ccc',set_name:'Gamma Set',image_uris:{png:'https://fixture.local/gamma.png'}},
      {set:'ddd',set_name:'Unavailable Set',image_uris:{png:'https://fixture.local/missing.png'}}
    ]})};
    if(url.includes('set=ddd')) return {ok:false,status:404};
    if(url.includes('fixture.local/')) return {ok:true,arrayBuffer:async()=>Uint8Array.from(atob(${JSON.stringify(png.toString('base64'))}), c=>c.charCodeAt(0)).buffer};
    const key=url.includes('set=bbb')?'beta':url.includes('set=ccc')?'gamma':'alpha';
    return {ok:true,json:async()=>(${JSON.stringify(fixtures)}[key])};
  }; void 0`);
  await js("document.getElementById('longText').value='2x Test Card'; document.getElementById('longForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitFor(async () => (await js("document.getElementById('set-select-0')?.options.length || 0")) === 4, 'Printing options did not load', 10000);
  const initialRows = await js("document.querySelectorAll('#output [id^=card-li-]').length");
  const initialImages = await js("document.querySelectorAll('#output img').length");
  assert(initialRows === 1 && initialImages === 1, `Unexpected initial card count for quantity 2: ${initialRows} rows, ${initialImages} images`);
  for (const [set, label, number, image] of [['bbb','[BBB]','27','beta.png'], ['ccc','[CCC]','5','gamma.png'], ['aaa','[AAA]','1','alpha.png'], ['bbb','[BBB]','27','beta.png']]) {
    await js(`(() => { const select=document.getElementById('set-select-0'); select.value=${JSON.stringify(set)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await waitFor(async () => (await js("document.getElementById('card-set-0')?.textContent")) === label && (await js("document.getElementById('card-img-0')?.src"))?.endsWith(image), `Printing ${label} did not update`, 5000);
    const state = await js("({rows:document.querySelectorAll('#output [id^=card-li-]').length, images:document.querySelectorAll('#output img').length, decklist:document.getElementById('longText').value})");
    assert(state.rows === initialRows && state.images === initialImages, `Switching to ${label} changed card count: ${JSON.stringify(state)}`);
    assert(state.decklist.includes(`(${label.slice(1,4)})`) && state.decklist.endsWith(number), `Decklist did not retain selected printing ${label}/${number}: ${state.decklist}`);
  }
  await js("const select=document.getElementById('set-select-0'); select.value='ddd'; select.dispatchEvent(new Event('change',{bubbles:true}))");
  await wait(200);
  await waitFor(async () => (await js('document.getElementById("card-set-0")?.textContent')) === '[BBB]', 'Unavailable printing did not preserve the current selection');
  assert(await js("document.getElementById('card-img-0').src.endsWith('beta.png') && document.getElementById('longText').value === '2x Test Card (BBB) 27'"), 'Failed printing lookup changed artwork or decklist');
  await js("document.querySelector('input[value=front_only]').click()");
  await click('nextCreatePdfBtn');
  await waitFor(async () => (await js('location.pathname')).endsWith('/CreatePDF/create.html'), 'Printing selection did not continue to PDF creation');
  const exported = fs.readdirSync(frontDir()).filter(name => name.endsWith('.png'));
  assert(exported.length === 2 && exported.includes('1testCard1.png') && exported.includes('2testCard1.png'), `Quantity 2 did not export as two images: ${exported.join(', ')}`);
}

async function pdfViewer() {
  ensureDirs();
  const pdf = path.join(outputDir(), 'viewer-fixture.pdf');
  fs.copyFileSync(path.join(root, 'calibration', 'letter-calibration.pdf'), pdf);
  await load(`Utilities/pdf_viewer.html?file=${encodeURIComponent(path.basename(pdf))}`);
  const src = await js("document.getElementById('pdfFrame').src");
  assert(src === pathToFileURL(pdf).href, `Viewer source mismatch: ${src}`);
  await js("require('electron').shell.showItemInFolder = filePath => { window.__folderPath = filePath; }; void 0");
  await js("Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Open in Folder').click()");
  assert(await js(`window.__folderPath === ${JSON.stringify(pdf)}`), 'Open in Folder did not pass the selected PDF path to Electron');
  await load('Utilities/pdf_viewer.html?file=../../etc/passwd');
  const safeSrc = await js("document.getElementById('pdfFrame').src");
  assert(safeSrc === pathToFileURL(path.join(outputDir(), 'game.pdf')).href, `Viewer accepted unsafe file path: ${safeSrc}`);
  await js("Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Back to Home').click()");
  await waitFor(async () => (await js('location.pathname')).endsWith('/Home/home.html'), 'PDF viewer Back to Home action failed');
  assert(await js("document.querySelector('h1')?.textContent.includes('Welcome')"), 'PDF viewer did not return to Home');
}

async function run() {
  assert(CASES.includes(caseName), `Unknown UI case: ${caseName}; use --list`);
  app.commandLine.appendSwitch('disable-gpu');
  await app.whenReady();
  // Keep all page traffic local and deterministic. Decklist injects its Scryfall fixture.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  require('../../GUI/Utilities/ipcHandlers');
  ipcMain.handle('updates:get-state', () => ({
    enabled: false, status: 'idle', currentVersion: '1.1.0', availableVersion: null,
    automaticChecks: false, lastCheckedAt: null, releaseNotes: '', progress: 0,
    canInstall: false, error: null, notificationVisible: false
  }));
  dialog.showOpenDialog = async options => {
    if (options.filters?.some(filter => filter.name === 'PDF')) return { canceled: !chosenPdf, filePaths: chosenPdf ? [chosenPdf] : [] };
    return { canceled: chosenFiles.length === 0, filePaths: chosenFiles };
  };
  ensureDirs();
  win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.webContents.on('render-process-gone', (_e, details) => errors.push(`Renderer exited: ${details.reason}`));
  win.webContents.on('did-fail-load', (_e, code, desc, url, mainFrame) => { if (mainFrame) errors.push(`Load failed ${code}: ${desc} ${url}`); });
  await ({ navigation, 'create-pdf': createPdf, settings, translation, decklist, 'decklist-printing': decklistPrinting, 'pdf-viewer': pdfViewer })[caseName]();
  assert(await js("!(window.__uiErrors || []).length"), `Uncaught renderer errors: ${JSON.stringify(await js('window.__uiErrors'))}`);
  fs.writeSync(1, `UI integration case passed: ${caseName}\n`);
}

const timeout = setTimeout(() => finish(new Error(`UI integration case timed out: ${caseName}`)), 150000);
run().then(() => finish(), finish);
function finish(error) {
  if (exitStarted) return;
  exitStarted = true;
  clearTimeout(timeout);
  if (error) fs.writeSync(2, `${error.stack || error}\n`);
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(error ? 1 : 0);
}

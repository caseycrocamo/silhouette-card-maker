'use strict';
// Run: GUI/node_modules/.bin/electron tests/printing-selector-smoke.cjs
const { app, BrowserWindow, session, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'printing-selector-'));
let win;
const errors = [];
const component = path.join(root, 'GUI/MagicTheGathering/printingSelector.js');
const imageHost = 'https://cards.scryfall.io/';
const imageRequests = new Map();
let holdImages = false;
const imageReplies = [];
function releaseImages() {
  holdImages = false;
  for (const reply of imageReplies.splice(0)) reply();
}
function card(id, set, number, date, extra = {}) {
  return { id, oracle_id: 'sol-ring', name: 'Sol Ring', set, set_name: set === 'cmm' ? 'Commander Masters' : 'Commander 2021', collector_number: number, released_at: date, image_uris: { normal: imageHost + id + '.png', png: imageHost + id + '.png' }, prints_search_uri: 'https://api.scryfall.com/cards/search?page=1', ...extra };
}
const fixtures = [
  card('current', 'c21', '263', '2021-04-23'),
  card('regular', 'cmm', '396', '2023-08-04'),
  card('borderless', 'cmm', '659', '2023-08-04', { border_color: 'borderless' }),
  card('double', 'isd', '1', '2011-09-30', { name: 'Delver of Secrets // Insectile Aberration', layout: 'transform', image_uris: undefined, card_faces: [{ name: 'Delver of Secrets', image_uris: { normal: imageHost + 'front.png', png: imageHost + 'front.png' } }, { name: 'Insectile Aberration', image_uris: { normal: imageHost + 'back.png', png: imageHost + 'back.png' } }] }),
];
async function js(code) { try{return await win.webContents.executeJavaScript(code);}catch(error){throw new Error(code.slice(0,180)+': '+error.message);} }
async function waitFor(expression, label) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await js(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(label + ': ' + await js("document.body.innerText"));
}
async function open(mode = 'normal') {
  await js(`window.mode=${JSON.stringify(mode)};document.getElementById('trigger').focus();window.closeDrawer=selector.openPrintingSelector({card:fixtures[0],trigger:document.getElementById('trigger'),onApply:card=>{if(window.mode==='apply-error')throw new Error('Fixture apply failure');window.applied.push(card);}});void 0;`);
}
async function choose(id) { await js(`document.querySelector('[data-printing-id="${id}"] input').click()`); }
async function click(id) { await js(`document.getElementById(${JSON.stringify(id)}).click()`); }
async function run() {
  app.on('window-all-closed', () => {});
  app.commandLine.appendSwitch('disable-gpu');
  app.setPath('userData', path.join(work, 'electron'));
  await app.whenReady();
  require('../GUI/Utilities/cardImageCache').registerCardImageCache({app,ipcMain,isTrusted:event=>{
    const source = require('node:url').fileURLToPath(event.senderFrame.url);
    return source === path.join(work,'fixture.html') || source.startsWith(path.join(root,'GUI')+path.sep);
  }});
  // Serve card images locally, so this test cannot use the network.
  session.defaultSession.protocol.interceptBufferProtocol('https', (request, callback) => {
    if (!request.url.startsWith(imageHost)) return callback({ error: -2 });
    imageRequests.set(request.url, (imageRequests.get(request.url) || 0) + 1);
    const id = new URL(request.url).pathname;
    const color = id.includes('borderless') ? '#8b5cbe' : id.includes('back') ? '#3d8066' : '#5b7196';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="502"><defs><radialGradient id="g"><stop stop-color="#bca466"/><stop offset="1" stop-color="${color}"/></radialGradient></defs><rect width="360" height="502" rx="16" fill="#171a21"/><rect x="12" y="12" width="336" height="478" rx="10" fill="#9e9c91"/><rect x="22" y="25" width="316" height="40" rx="6" fill="#d3d0c2"/><text x="34" y="53" font-size="24" font-family="serif">Sol Ring</text><rect x="22" y="77" width="316" height="265" fill="url(#g)"/><ellipse cx="180" cy="209" rx="78" ry="48" transform="rotate(-30 180 209)" fill="none" stroke="#e9c57c" stroke-width="22"/><rect x="22" y="354" width="316" height="120" fill="#d3d0c2"/><text x="35" y="384" font-size="20" font-family="serif">Artifact</text><text x="35" y="428" font-size="18" font-family="serif">Add two colorless mana.</text></svg>`;
    const reply = () => callback({ mimeType: 'image/svg+xml', headers: {'Content-Disposition':'inline; filename=Sol Ring ★.png'}, data: Buffer.from(svg) });
    if (holdImages) imageReplies.push(reply);
    else reply();
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${path.join(root, 'GUI/styles/main.css')}"><link rel="stylesheet" href="${path.join(root, 'GUI/MagicTheGathering/printingSelector.css')}"></head><body class="bg-surface text-content"><main style="padding:30px;max-width:40%"><h1 style="font-size:28px;margin-bottom:20px">PrintLister</h1><h2 style="font-size:22px">Your cards</h2><p style="margin:12px 0">Choose a printing for each card.</p><img src="${imageHost}current.png" alt="Current card" style="width:200px"><p>Sol Ring · C21 #263</p><button id="trigger" class="paper-button" style="margin-top:16px">Change printing</button></main></body></html>`;
  fs.writeFileSync(path.join(work, 'fixture.html'), html);
  win = new BrowserWindow({ show: false, width: 1536, height: 1024, webPreferences: { backgroundThrottling: false, nodeIntegration: true, contextIsolation: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level === 3 && !message.includes('ERR_FAILED')) errors.push(message); });
  await win.loadFile(path.join(work, 'fixture.html'));
  await js(`window.selector=require(${JSON.stringify(component)});window.fixtures=${JSON.stringify(fixtures)};window.applied=[];window.requests=[];window.mode='normal';window.failOnce=false;window.fetch=async (url,options)=>{requests.push(url);if(mode==='deferred')return new Promise(resolve=>window.resolveDeferred=()=>resolve({ok:true,json:async()=>({data:fixtures,has_more:false})}));if(mode==='error'&&!failOnce){failOnce=true;throw new Error('Fixture load failure')}if(mode==='noimage')return {ok:true,json:async()=>({data:[...fixtures,{id:'no-image',name:'Sol Ring',set:'cmm',set_name:'Commander Masters',collector_number:'999'}],has_more:false})};if(mode==='empty')return {ok:true,json:async()=>({data:[],has_more:false})};if(String(url).includes('page=2'))return {ok:true,json:async()=>({data:fixtures.slice(2),has_more:false})};return {ok:true,json:async()=>({data:fixtures.slice(0,2),has_more:true,next_page:'https://api.scryfall.com/cards/search?page=2'})};};void 0;`);
  holdImages = true;
  await open();
  await waitFor("document.querySelectorAll('.printing-option').length===4", 'All pages and same-set printings load');
  assert(await js("Boolean(document.querySelector('#printingPreview .loading-spinner') && document.querySelector('.printing-option .loading-spinner'))"), 'Printing previews show spinners while images are pending');
  assert.equal(await js("getComputedStyle(document.querySelector('#printingPreview .loading-spinner')).animationName"),'image-loading-spin');
  releaseImages();
  await waitFor("Array.from(document.querySelectorAll('#printingSelectorDialog img')).every(i=>i.complete && i.naturalWidth>0)", 'Initial images finish loading');
  assert.equal(await js("requests.length"), 2);
  assert.equal(await js("document.querySelectorAll('.printing-option img').length"), 4);
  assert(await js("Array.from(document.querySelectorAll('.printing-option img')).every(img=>getComputedStyle(img).display!=='none')"));
  assert(await js("Array.from(document.querySelectorAll('#printingSelectorDialog button')).every(b=>b.classList.contains('paper-button'))"));
  await choose('borderless');
  assert.equal(await js('applied.length'), 0, 'Choosing is a draft');
  assert(!await js("/\\bSelected\\b/.test(document.getElementById('printingList').innerText)"), 'No redundant Selected label');
  await js("document.querySelector('[data-printing-id=borderless] input').focus()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});
  await waitFor("!document.querySelector('[data-printing-id=borderless] input').checked", 'Arrow key changes printing');
  assert.equal(await js("document.querySelectorAll('.printing-option input:checked').length"), 1);
  await click('printingCancel');
  assert.equal(await js('applied.length'), 0);
  assert.equal(await js('document.activeElement.id'), 'trigger');
  await js(`window.fixtureFetch=window.fetch;window.fetch=async(url,options)=>{
    if(!mode.startsWith('batch'))return fixtureFetch(url,options);
    requests.push(url);
    const count=Number(mode.slice(5));
    const cards=Array.from({length:count},(_,i)=>({...fixtures[0],id:'batch-'+i,collector_number:String(i+1),image_uris:{png:'${imageHost}batch-'+i+'.png'}}));
    const second=String(url).includes('page=2');
    return {ok:true,json:async()=>({data:second?cards.slice(30):cards.slice(0,30),has_more:!second&&count>30,next_page:'https://api.scryfall.com/cards/search?page=2'})};
  };void 0;`);
  for(const total of [24,25,26,50,60]) {
    const requestsBefore=await js('requests.length');
    await open('batch'+total);
    await waitFor(`document.querySelectorAll('.printing-option').length===${Math.min(total,25)} && !document.getElementById('printingApply').disabled`, 'First 25 printings');
    assert.equal(await js('requests.length'),requestsBefore+1,'Later API pages do not load on open');
    assert.equal(await js("document.getElementById('printingLoadMore').hidden"),total<=25);
    let visible=25;
    while(visible<total) {
      await click('printingLoadMore');
      visible=Math.min(visible+25,total);
      await waitFor(`document.querySelectorAll('.printing-option').length===${visible} && !document.getElementById('printingApply').disabled`, 'Next 25 printings');
      assert.equal(await js("document.getElementById('printingLoadMore').hidden"),visible===total,'Load more is hidden after the final printing');
    }
    await click('printingCancel');
  }
  await open();
  await waitFor("document.querySelectorAll('.printing-option').length===4", 'Reopen');
  await choose('borderless');
  await click('printingApply');
  assert.equal(await js('applied[0].id'), 'borderless');
  assert.equal(await js('applied[0].collector_number'), '659');
  await open();
  await waitFor("document.querySelectorAll('.printing-option').length===4", 'Search ready');
  await js("document.getElementById('printingSearch').value='659';document.getElementById('printingSearch').dispatchEvent(new Event('input'))");
  await waitFor("document.querySelectorAll('.printing-option').length===1", 'Collector number search');
  assert.equal(await js("document.querySelector('.printing-option').dataset.printingId"), 'borderless');
  await js("document.getElementById('printingSearch').value='no such printing';document.getElementById('printingSearch').dispatchEvent(new Event('input'))");
  await waitFor("document.querySelectorAll('.printing-option').length===0", 'Empty search');
  await js("document.getElementById('printingSearch').value='';document.getElementById('printingSearch').dispatchEvent(new Event('input'));document.getElementById('printingSort').value='set';document.getElementById('printingSort').dispatchEvent(new Event('change'))");
  await waitFor("document.querySelectorAll('.printing-option').length===4", 'Search reset');
  const names = await js("Array.from(document.querySelectorAll('.printing-option')).map(x=>x.innerText)");
  assert(names[0].includes('Commander 2021'), 'Set-name sort');
  await choose('double');
  await click('printingBack');
  assert(await js("document.getElementById('printingPreview').querySelector('img').dataset.imageSource.includes('back.png')"));
  await click('printingFront');
  assert(await js("document.getElementById('printingPreview').querySelector('img').dataset.imageSource.includes('front.png')"));
  await js("document.querySelector('.printing-option img').dispatchEvent(new Event('error'))");
  assert(await js("document.getElementById('printingList').innerText.toLowerCase().includes('preview') || document.getElementById('printingList').innerText.toLowerCase().includes('image')"), 'Image failure has fallback');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await waitFor("!document.getElementById('printingSelectorDialog')?.open", 'Escape closes drawer');
  assert.equal(await js("Boolean(document.getElementById('printingSelectorDialog')?.open)"), false);
  await open('error');
  await waitFor("Boolean(document.getElementById('printingRetry'))", 'Retry after load failure');
  await js("document.getElementById('printingSearch').value='';document.getElementById('printingSearch').dispatchEvent(new Event('input'))");
  assert.match(await js("document.getElementById('printingStatus').innerText"), /Unable to load/);
  await click('printingRetry');
  await waitFor("document.querySelectorAll('.printing-option').length===4", 'Retry recovery');
  await click('printingClose');
  await open('empty');
  await waitFor("document.getElementById('printingList').innerText.includes('No printings')", 'Empty API result');
  assert(await js("document.getElementById('printingApply').disabled"));
  await click('printingCancel');
  await open('deferred');
  await waitFor("typeof resolveDeferred==='function'", 'Deferred request starts');
  await click('printingCancel');
  await js('resolveDeferred()');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await js("Boolean(document.getElementById('printingSelectorDialog')?.open)"), false, 'Stale result cannot reopen drawer');
  assert.equal(await js('applied.length'), 1);
  await open('apply-error');
  await waitFor("document.querySelectorAll('.printing-option').length===4", 'Apply error fixture ready');
  await choose('borderless');
  await click('printingApply');
  await waitFor("Boolean(document.getElementById('printingApplyError') && !document.getElementById('printingApplyError').hidden)", 'Apply failure shown');
  assert(await js("document.getElementById('printingSelectorDialog').open && document.querySelector('[data-printing-id=borderless] input').checked"), 'Failed Apply keeps the draft and dialog');
  assert.equal(await js('applied.length'), 1, 'Failed Apply does not commit');
  await click('printingCancel');
  await open('noimage');
  await waitFor("document.querySelectorAll('.printing-option').length===5", 'Printing without image data');
  await choose('no-image');
  assert(await js("document.getElementById('printingApply').disabled"), 'Unprintable result cannot be applied');
  await click('printingCancel');
  await open();
  await waitFor("document.querySelectorAll('.printing-option').length===4", 'Screenshot ready');
  await choose('borderless');
  await waitFor("Array.from(document.querySelectorAll('#printingSelectorDialog img')).every(i=>i.complete && i.naturalWidth>0)", 'Fixture images load');
  assert.equal(imageRequests.get(imageHost+'borderless.png'),1,'Reopening and rebuilding previews reuse one image download');
  const screenshot = path.join(work, 'implemented-side-panel.png');
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  win.setSize(375, 812);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(await js("document.getElementById('printingSelectorDialog').scrollWidth<=document.getElementById('printingSelectorDialog').clientWidth"), 'Panel has no horizontal overflow at 375px');
  assert(await js("document.documentElement.scrollWidth<=window.innerWidth"), 'Page has no horizontal overflow at 375px');
  await click('printingCancel');
  assert.deepEqual(errors, []);
  // Exercise the active shared card-list route, not only the standalone component.
  win.destroy();
  const preload = path.join(work, 'mtg-preload.cjs');
  fs.writeFileSync(preload, `window.fixtureCards=${JSON.stringify(fixtures)};window.apiRequests=[];window.fetch=async url=>{apiRequests.push(String(url));return {ok:true,json:async()=>String(url).includes('/search')?{data:fixtureCards,has_more:false}:fixtureCards[0]};};`);
  ipcMain.on('get-user-data-dir', event => { event.returnValue = null; });
  ipcMain.handle('updates:get-state', () => ({ status: 'idle', enabled: false }));
  ipcMain.handle('read-offset-data', () => ({ x_offset: 0, y_offset: 0 }));
  ipcMain.handle('get-default-calibration-pdf', () => '');
  win = new BrowserWindow({ show: false, width: 1536, height: 1024, webPreferences: { backgroundThrottling: false, nodeIntegration: true, contextIsolation: false, preload } });
  holdImages = true;
  await win.loadFile(path.join(root, 'GUI/CardList/decklist.html'), { query: { game: 'mtg' } });
  await js("document.getElementById('longText').value='3x Sol Ring';document.getElementById('longText').dispatchEvent(new Event('input'));document.getElementById('longForm').requestSubmit()");
  await waitFor("Boolean(document.querySelector('[id^=change-printing-]'))", 'Active MTG printing trigger');
  assert(await js("Boolean(document.querySelector('#output .card-image-frame[aria-busy=true] .loading-spinner'))"), 'Deck image shows a spinner during download');
  releaseImages();
  await waitFor("document.querySelector('#output .card-image-status').hidden", 'Deck spinner clears after image load');
  assert.equal(await js("getComputedStyle(document.querySelector('#printingHint em')).fontStyle"),'italic','Printing reminder is italic');
  assert.equal(await js("document.getElementById('printingHint').hidden"),false);
  assert(await js("Boolean(document.querySelector('[id^=change-printing-] img'))"),'Card image is the printing control');
  assert(!await js("Array.from(document.querySelectorAll('#output button')).some(b=>b.textContent.trim()==='Change printing')"),'No separate Change printing button');
  assert.equal(await js("apiRequests.filter(x=>x.includes('/search')).length"), 0, 'No eager printing request');
  await js("document.querySelector('[id^=change-printing-] img').click()");
  await waitFor("document.querySelectorAll('.printing-option').length===4", 'Active route printing drawer');
  await choose('borderless');
  assert.equal(await js("document.getElementById('longText').value"), '3x Sol Ring (C21) 263', 'Draft preserves current entry');
  assert(await js("document.querySelector('#output article').getBoundingClientRect().right <= document.getElementById('printingSelectorDialog').getBoundingClientRect().left"), 'Current deck card stays visible beside the desktop drawer');
  assert.equal(await js("getComputedStyle(document.getElementById('longForm').closest('section')).display"), 'none', 'Desktop drawer hides the editor');
  await waitFor("Array.from(document.querySelectorAll('#printingSelectorDialog img')).every(i=>i.complete && i.naturalWidth>0)", 'Active page fixture images');
  assert(await js("!document.getElementById('printingApply').disabled && document.querySelector('[data-printing-id=borderless] input').checked"));
  await waitFor("Array.from(document.querySelectorAll('#printingSelectorDialog .printing-image__state')).every(s=>s.hidden && getComputedStyle(s).display==='none')", 'Loading states hidden');
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await new Promise(resolve=>setTimeout(resolve,150));
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  const selectedBlob = await js("document.getElementById('printingPreview').querySelector('img').src");
  const downloadsBeforeApply = imageRequests.get(imageHost+'borderless.png');
  assert.equal(downloadsBeforeApply,2,'Closing the last window cleared the previous session image cache');
  await click('printingApply');
  await waitFor("document.querySelector('#output article img').complete && document.querySelector('#output article img').naturalWidth>0", 'Applied image reused');
  assert.equal(await js("document.querySelector('#output article img').src"),selectedBlob,'Deck uses the same cached image as the preview');
  assert.equal(imageRequests.get(imageHost+'borderless.png'),downloadsBeforeApply,'Apply does not download the image again');
  assert.equal(await js("document.getElementById('longText').value"), '3x Sol Ring (CMM) 659');
  assert.notEqual(await js("getComputedStyle(document.getElementById('longForm').closest('section')).display"), 'none', 'Apply restores the editor');
  assert.equal(await js("document.querySelectorAll('#output article').length"), 1, 'No extra deck entries');
  assert(await js("document.activeElement.id.startsWith('change-printing-')"), 'Apply returns focus to the new trigger');
  assert.match(await js("document.getElementById('output').innerText"), /×3/);
  assert.equal(await js("require('../shared/cardList/sessionStore').createStore(sessionStorage,'mtg').load().draft"), '3x Sol Ring (CMM) 659');
  await js("document.querySelector('[id^=change-printing-]').focus()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
  await waitFor("Boolean(document.getElementById('printingSelectorDialog')?.open)", 'Drawer reopens');
  await js("document.getElementById('longText').value='Counterspell';document.getElementById('longText').dispatchEvent(new Event('input'))");
  assert.equal(await js("Boolean(document.getElementById('printingSelectorDialog')?.open)"), false, 'Manual deck edit closes drawer');
  const downloadsBeforeReload = new Map(imageRequests);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
  await waitFor("Boolean(document.querySelector('#output article img'))",'Saved deck restored after reload');
  await waitFor("document.querySelector('#output article img').complete && document.querySelector('#output article img').naturalWidth>0",'Cached image after page reload');
  assert.deepEqual(imageRequests,downloadsBeforeReload,'Page reload reuses main-process image bytes');
  await win.loadFile(path.join(root,'GUI/Settings/settings.html'));
  assert.equal(await js("document.getElementById('printingPageSize').value"),'25','Settings defaults to 25');
  await js("document.getElementById('printingPageSize').value='7';document.getElementById('printingPreferencesForm').requestSubmit()");
  await waitFor("document.getElementById('printingPreferencesStatus').textContent.startsWith('Saved')",'Printing preference saved');
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
  assert.equal(await js("document.getElementById('printingPageSize').value"),'7','Saved page size survives reload');
  await win.loadFile(path.join(root,'GUI/CardList/decklist.html'),{query:{game:'mtg'}});
  await waitFor("Boolean(document.querySelector('[id^=change-printing-]'))",'MTG restored after settings');
  await js("fixtureCards.push(...Array.from({length:10},(_,i)=>({...fixtureCards[0],id:'extra-'+i,collector_number:String(i+500)})));document.querySelector('[id^=change-printing-] img').click()");
  await waitFor("document.querySelectorAll('.printing-option').length===7 && !document.getElementById('printingApply').disabled",'Configured first batch');
  assert.equal(await js("document.getElementById('printingLoadMore').hidden"),false);
  await click('printingLoadMore');
  await waitFor("document.querySelectorAll('.printing-option').length===14 && !document.getElementById('printingApply').disabled",'Configured next batch');
  assert.equal(await js("document.getElementById('printingLoadMore').hidden"),true,'Link hides after final configured batch');
  process.stdout.write('Printing selector Electron smoke passed\n');
}
let finishing = false;
const timeout = setTimeout(() => finish(new Error('Printing selector smoke timed out')), 90000);
function finish(error) {
  if (finishing) return;
  finishing = true;
  clearTimeout(timeout);
  if (error) process.stderr.write((error.stack || String(error)) + '\n');
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(work, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}
run().then(() => finish(), finish);

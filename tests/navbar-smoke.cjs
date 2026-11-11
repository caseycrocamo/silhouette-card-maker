'use strict';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'navbar-smoke-'));
const artifacts = process.env.NAVBAR_SCREENSHOT_DIR || path.join(work, 'screenshots');
fs.mkdirSync(artifacts, { recursive: true });
const pages = [
  ['Home/home.html', 1], ['CardList/decklist.html', 2],
  ['MagicTheGathering/text_translation.html', 2], ['CreatePDF/create.html', 3],
  ['Settings/settings.html', 0], ['Tools/tools.html', 0],
];
let win;
let updateState = { status: 'idle', notificationVisible: false, enabled: true };
const calls = [], errors = [];
const js = code => win.webContents.executeJavaScript(code);
async function settle() {
  await waitFor(() => js("!document.querySelector('.navbar-menu-toggle') || document.querySelector('.navbar-menu-toggle').hidden === !matchMedia('(max-width: 1279px)').matches"), 'Responsive menu state did not settle');
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await waitFor(() => js("!document.querySelector('nav-bar nav') || document.querySelector('nav-bar nav').getAnimations({subtree:true}).every(animation=>animation.effect.getTiming().iterations===Infinity || animation.playState!=='running')"), 'Navbar animation did not settle');
  await waitFor(() => js("!document.querySelector('nav-bar nav') || Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height'))-document.querySelector('nav-bar nav').getBoundingClientRect().bottom)<=1"), 'Navbar measurement did not settle');
}
async function viewport(width, zoom = 1) {
  win.setContentSize(width, 960);
  win.webContents.setZoomFactor(zoom);
  await waitFor(() => js(`Math.abs(innerWidth-${width / zoom})<=1`), 'Viewport did not resize');
  await settle();
}
async function waitFor(check, message) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(message + ': ' + errors.join(' | '));
}
function publish(state) {
  updateState = state;
  win.webContents.send('updates:state', state);
}
async function screenshot(name) {
  await js("(async()=>{const nav=document.querySelector('nav-bar nav');await Promise.all(nav.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await new Promise(resolve=>setTimeout(resolve,100));})()");
  fs.writeFileSync(path.join(artifacts, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
function setupIpc() {
  ipcMain.on('get-user-data-dir', event => { event.returnValue = work; });
  const paper = { name: 'letter', width: '8.5in', height: '11in' };
  const catalog = { ok: true, output_dir: path.join(work, 'templates'), card_sizes: [{ name: 'standard', width: '63mm', height: '88mm' }], paper_sizes: [paper], specialty_layouts: [] };
  const groups = require('../GUI/shared/pdfCreationSettings').GROUPS;
  const defaultValues = { only_fronts: false, borderless: false, load_offset: false, show_outline: false, output_images: false, skip: [], label: null, specialty: null, registration_orientation: null, ppi: 300, quality: 100, registration: 'three', fit: 'stretch', fit_backs: 'stretch', card_size: 'standard', paper_size: 'letter' };
  const metadata = { ...catalog, options: Object.values(groups).flat().map(name => ({ name, default: defaultValues[name] ?? '', is_flag: ['only_fronts', 'borderless', 'load_offset', 'show_outline', 'output_images'].includes(name), multiple: name === 'skip' })) };
  for (const [channel, handler] of Object.entries({
    'offset-data-exists': () => true,
    'updates:get-state': () => updateState,
    'read-offset-data': () => ({ x_offset: 0, y_offset: 0, angle_offset: 0 }),
    'get-calibration-capabilities': () => catalog,
    'get-default-calibration-pdf': () => path.join(work, 'calibration.pdf'),
    'get-translation-capabilities': () => ({ ...catalog, defaultOutputPath: path.join(work, 'translation.pdf') }),
    'get-pdf-capabilities': () => metadata,
    'preflight-create-pdf': () => ({ ok: true, warnings: [], errors: [], positions: [] }),
    'get-front-images': () => [], 'get-back-images': () => [], 'get-double-sided-images': () => [],
    'template-request': () => catalog,
    'studio-capabilities': () => ({ supported: false }),
    'card-request': () => ({ entries: [], errors: [] }),
    'updates:download': () => { calls.push('download'); },
    'updates:dismiss': () => { calls.push('dismiss'); publish({ ...updateState, notificationVisible: false }); },
  })) ipcMain.handle(channel, handler);
}
async function checkLayout(page, step, width, zoom, menuOpen = false) {
  const result = await js(`(() => {
    const nav=document.querySelector('nav-bar nav');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const wordmark=nav.querySelector('.navbar-wordmark');
    const textRange=document.createRange();textRange.selectNodeContents(wordmark);
    const links=[...nav.querySelectorAll('a')];
    const mask=nav.querySelector('.navbar-erase-mask');
    const visible=e=>{const r=e.getBoundingClientRect(),m=mask?.getBoundingClientRect();const erased=!!e.closest('.navbar-steps')&&nav.dataset.menuOpen==='true'&&m&&m.left<=r.left&&m.right>=r.right&&m.top<=r.top&&m.bottom>=r.bottom;return r.width>0&&getComputedStyle(e).visibility!=='hidden'&&!erased;};
    const toggle=nav.querySelector('.navbar-menu-toggle');
    const labels=[...nav.querySelectorAll('.navbar-step-label')];
    const surface=document.createElement('span');
    surface.style.backgroundColor='color-mix(in srgb, var(--app-surface-dark) 65%, '+getComputedStyle(document.body).backgroundColor+')';
    document.body.appendChild(surface);
    const dimmedPageBackground=getComputedStyle(surface).backgroundColor;
    surface.remove();
    return {
      viewport:innerWidth, scrollY, document:document.documentElement.scrollWidth,
      nav:rect(nav), identity:rect(textRange), brand:wordmark.textContent, brandVisible:visible(wordmark), utilityGroup:rect(nav.querySelector('.navbar-utilities')), first:rect(document.querySelector('main').firstElementChild),
      links:links.filter(visible).map(e=>({...rect(e),label:e.getAttribute('aria-label')||e.textContent.trim(),href:e.getAttribute('href')})),
      toggle:toggle?{...rect(toggle),visible:visible(toggle),expanded:toggle.getAttribute('aria-expanded'),controls:toggle.getAttribute('aria-controls'),label:toggle.getAttribute('aria-label'),shared:toggle.classList.contains('paper-button'),target:!!document.getElementById(toggle.getAttribute('aria-controls'))}:null,
      labels:labels.map(e=>({...rect(e),visible:visible(e),opacity:getComputedStyle(e).opacity,display:getComputedStyle(e).display,text:e.textContent})),
      shellRole:nav.getAttribute('role'),modal:nav.getAttribute('aria-modal'),shellBackground:mask?getComputedStyle(mask).backgroundColor:null,eraseMask:mask?rect(mask):null,bodyBackground:dimmedPageBackground,
      stepsInert:nav.querySelector('.navbar-steps').inert,stepsHidden:nav.querySelector('.navbar-steps').getAttribute('aria-hidden'),mainInert:document.querySelector('main').inert,bodyOverflow:getComputedStyle(document.body).overflow,
      middleLine:nav.querySelector('.navbar-menu-line--middle')?getComputedStyle(nav.querySelector('.navbar-menu-line--middle')).opacity:null,
      topLine:nav.querySelector('.navbar-menu-line--top')?getComputedStyle(nav.querySelector('.navbar-menu-line--top')).transform:null,
      bottomLine:nav.querySelector('.navbar-menu-line--bottom')?getComputedStyle(nav.querySelector('.navbar-menu-line--bottom')).transform:null,
      sidebar:rect(nav.querySelector('.navbar-utilities')),viewportHeight:innerHeight,
      current:[...nav.querySelectorAll('[aria-current="step"]')].map(e=>e.textContent),
      utilities:[...nav.querySelectorAll('[aria-current="page"]')].map(e=>e.getAttribute('href')),
      badgeCount:nav.querySelectorAll('.navbar-completion-badge').length,
      orderedCount:nav.querySelectorAll('ol > li').length,
      iconDecorative:[...nav.querySelectorAll('svg')].every(e=>e.getAttribute('aria-hidden')==='true'),
      utilityShared:[...nav.querySelectorAll('.navbar-utilities a')].every(e=>e.classList.contains('paper-button')),
      heightVar:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height')),
    };
  })()`);
  const name = `${page} ${width}px zoom ${zoom}`;
  assert.ok(result.document <= result.viewport + 1, `${name}: horizontal page overflow ${JSON.stringify(result)}`);
  assert.ok(result.first.top >= result.nav.bottom, `${name}: content starts above navbar bottom ${JSON.stringify(result)}`);
  assert.ok(Math.abs(result.heightVar - result.nav.bottom) <= 1, `${name}: measured height`);
  const compact = result.viewport <= 1279;
  assert.equal(result.brand, 'Silhouette', name);
  assert.equal(result.brandVisible, !compact, `${name}: responsive brand visibility`);
  if (!compact) {
    assert.ok(result.identity.width > 0 && result.identity.height > 0, `${name}: brand hidden`);
    assert.ok(result.identity.right <= result.utilityGroup.left + 1 || result.identity.bottom <= result.utilityGroup.top + 1, `${name}: identity and utilities overlap`);
  }
  assert.ok(result.toggle, `${name}: hamburger missing`);
  assert.equal(result.toggle.visible, compact, `${name}: responsive toggle visibility`);
  assert.equal(result.toggle.shared, true, `${name}: toggle bypasses shared button`);
  assert.ok(result.toggle.target && result.toggle.label, `${name}: toggle has no accessible name or target`);
  if (compact) {
    assert.equal(result.toggle.expanded, String(menuOpen), `${name}: incorrect menu expansion`);
    assert.equal(result.toggle.label, menuOpen ? 'Close menu' : 'Templates and settings', `${name}: toggle accessible name`);
    assert.ok(result.toggle.height >= 44 && result.toggle.width >= 44, `${name}: small menu target`);
    assert.ok(result.toggle.left >= 0 && result.toggle.right <= result.viewport + 1, `${name}: menu toggle outside viewport`);
    for (const link of result.links) assert.ok(link.right <= result.toggle.left + 1 || result.toggle.right <= link.left + 1 || link.bottom <= result.toggle.top + 1 || result.toggle.bottom <= link.top + 1, `${name}: toggle overlaps ${link.label}`);
  }
  assert.equal(result.orderedCount, 3, name);
  assert.equal(result.badgeCount, step ? step - 1 : 0, name);
  assert.equal(result.current.length, step ? 1 : 0, name);
  if (step) assert.match(result.current[0], new RegExp(String(step)), name);
  assert.deepEqual(result.utilities, page.startsWith('Settings') ? ['../Settings/settings.html'] : page.startsWith('Tools') ? ['../Tools/tools.html'] : [], name);
  assert.equal(result.iconDecorative, true, name);
  assert.equal(result.utilityShared, true, name);
  assert.equal(result.links.length, compact ? menuOpen ? 2 : 3 : 5, name);
  for (const link of result.links) {
    assert.ok(link.height >= 44, `${name}: small target ${link.label}`);
    assert.ok(link.left >= 0 && link.right <= result.viewport + 1, `${name}: link outside viewport ${link.label}`);
  }
  for (let i = 0; i < result.links.length; i++) for (let j = i + 1; j < result.links.length; j++) {
    const a = result.links[i], b = result.links[j];
    assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `${name}: overlapping links ${a.label}/${b.label}`);
  }
  for (const label of result.labels) {
    assert.equal(label.visible, !menuOpen, `${name}: process label visibility ${label.text}`);
    if (!menuOpen) assert.ok(label.width > 0 && label.height > 0 && label.opacity === '1' && label.display !== 'none', `${name}: hidden label ${label.text}`);
  }
  assert.equal(result.mainInert, menuOpen, `${name}: background inert state`);
  assert.equal(result.stepsInert, menuOpen, `${name}: process inert state`);
  if (menuOpen) {
    assert.equal(result.shellRole, 'dialog', `${name}: missing dialog role`);
    assert.equal(result.modal, 'true', `${name}: missing modal state`);
    assert.equal(result.stepsHidden, 'true', `${name}: process still announced`);
    assert.equal(result.bodyOverflow, 'hidden', `${name}: background scrolling enabled`);
    assert.equal(result.shellBackground, result.bodyBackground, `${name}: navbar mask background does not match app`);
    assert.ok(result.eraseMask && result.eraseMask.left <= 0 && result.eraseMask.right >= result.viewport, `${name}: navbar erase mask does not cover viewport`);
    assert.equal(result.middleLine, '0', `${name}: hamburger middle line remains`);
    assert.ok(result.topLine && result.topLine !== 'none' && result.bottomLine && result.bottomLine !== 'none' && result.topLine !== result.bottomLine, `${name}: hamburger did not transform to X`);
    assert.ok(Math.abs(result.sidebar.right-result.viewport)<=1 && Math.abs(result.sidebar.top)<=1 && Math.abs(result.sidebar.bottom-result.viewportHeight)<=1, `${name}: sidebar is not anchored to viewport right`);
  } else {
    assert.equal(result.modal, null, `${name}: closed menu is modal`);
    assert.notEqual(result.shellRole, 'dialog', `${name}: closed menu retains dialog role`);
  }
  assert.equal(result.labels.length, 3, name);
}
async function checkBanner(width, menuOpen = false) {
  await viewport(width);
  if (menuOpen) {
    await js("document.querySelector('.navbar-menu-toggle').click()");
    await settle();
  }
  publish({ status: 'available', notificationVisible: true, availableVersion: '99.0.0', canInstall: true, releaseNotes: '<img src=x onerror=alert(1)>\nOffline fixture.' });
  await waitFor(() => js("!document.querySelector('#sharedUpdateBanner').classList.contains('hidden')"), 'Update banner did not appear');
  const result = await js(`(() => {const b=document.querySelector('#sharedUpdateBanner'),r=b.getBoundingClientRect(),n=document.querySelector('nav-bar nav').getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,navBottom:n.bottom,viewport:innerWidth,height:innerHeight,unsafe:!!b.querySelector('img'),notes:b.textContent};})()`);
  assert.ok(result.top > result.navBottom, `Banner overlaps navbar at ${width}`);
  assert.ok(result.bottom <= result.height + 1 && result.left >= 0 && result.right <= result.viewport + 1, `Banner outside viewport at ${width}`);
  assert.equal(result.unsafe, false);
  assert.match(result.notes, /<img src=x/);
  if (menuOpen) {
    assert.equal(await js("document.querySelector('#sharedUpdateBanner').inert"), true, 'Update banner remains interactive behind sidebar');
    await js("document.querySelector('.navbar-menu-toggle').click()");
    await settle();
  }
  await js("[...document.querySelectorAll('#sharedUpdateBanner button')].find(b=>b.textContent==='Download update').click()");
  await waitFor(() => calls.includes('download'), 'Download action not called');
  await js("[...document.querySelectorAll('#sharedUpdateBanner button')].find(b=>b.textContent==='Later').click()");
  await waitFor(() => js("document.querySelector('#sharedUpdateBanner').classList.contains('hidden')"), 'Dismiss action did not hide banner');
  assert.ok(calls.includes('dismiss'));
}
async function checkKeyboard() {
  await viewport(1440);
  win.show(); win.focus(); win.webContents.focus();
  await js("document.querySelector('nav-bar a').focus()");
  const expected = ['../Home/home.html', '../CardList/decklist.html?game=mtg', '../CreatePDF/create.html', '../Tools/tools.html', '../Settings/settings.html'];
  for (let i = 0; i < expected.length; i++) {
    assert.equal(await js('document.activeElement.getAttribute("href")'), expected[i], 'Keyboard order');
    assert.equal(await js("(() => {const s=getComputedStyle(document.activeElement);return s.outlineStyle!=='none'&&s.outlineWidth!=='0px'||s.boxShadow!=='none';})()"), true, 'Visible focus');
    if (i + 1 < expected.length) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await settle();
    }
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(() => win.webContents.getURL().includes('/Settings/') && !win.webContents.isLoading(), 'Enter did not activate Settings');
  await waitFor(() => js("!!document.querySelector('nav-bar [aria-current=page]')"), 'Settings navbar not ready');
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode === 'Return' || keyCode === 'Space') win.webContents.sendInputEvent({ type: 'char', keyCode: keyCode === 'Return' ? '\r' : ' ' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await settle();
}
async function menuExpanded() {
  return js("document.querySelector('.navbar-menu-toggle').getAttribute('aria-expanded')");
}
async function checkCompactMenu() {
  await viewport(375);
  await js("scrollTo(0,0);document.querySelector('.navbar-step').focus()");
  for (const href of ['../Home/home.html', '../CardList/decklist.html?game=mtg', '../CreatePDF/create.html']) {
    assert.equal(await js('document.activeElement.getAttribute("href")'), href, 'Compact process tab order');
    await key('Tab');
  }
  assert.equal(await js("document.activeElement.matches('.navbar-menu-toggle')"), true, 'Toggle follows process links');
  assert.equal(await menuExpanded(), 'false');
  await key('Tab');
  assert.equal(await js("!!document.activeElement.closest('.navbar-utilities')"), false, 'Closed menu links remain in tab order');
  win.focus();win.webContents.focus();
  await js("document.querySelector('.navbar-menu-toggle').focus()");
  await key('Return');
  await waitFor(async () => await menuExpanded() === 'true', 'Enter does not open menu');
  await checkLayout('Settings/settings.html', 0, 375, 1, true);
  await js("document.querySelector('.navbar-menu-toggle').focus()");
  await key('Tab');
  assert.equal(await js('document.activeElement.getAttribute("href")'), '../Tools/tools.html', 'First expanded utility');
  await key('Tab');
  assert.equal(await js('document.activeElement.getAttribute("href")'), '../Settings/settings.html', 'Second expanded utility');
  await key('Tab');
  assert.equal(await js("document.activeElement.matches('.navbar-menu-toggle')"), true, 'Tab escapes sidebar after last utility');
  await key('Tab', ['shift']);
  assert.equal(await js('document.activeElement.getAttribute("href")'), '../Settings/settings.html', 'Shift+Tab escapes sidebar before toggle');
  await js("document.querySelector('main button').focus()");
  assert.equal(await js("!!document.activeElement.closest('.navbar-utilities')||document.activeElement.matches('.navbar-menu-toggle')"), true, 'Background accepts focus while modal is open');
  await key('Escape');
  await waitFor(async () => await menuExpanded() === 'false', 'Escape does not close menu');
  assert.equal(await js("document.activeElement.matches('.navbar-menu-toggle')"), true, 'Escape does not restore toggle focus');
  await key('Space');
  await waitFor(async () => await menuExpanded() === 'true', 'Space does not open menu');
  const y = await js('Math.floor(innerHeight/2)');
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: 8, y, clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: 8, y, clickCount: 1 });
  await settle();
  assert.equal(await menuExpanded(), 'false', 'Outside pointer does not close menu');
  assert.equal(await js("document.activeElement.matches('.navbar-menu-toggle')"), true, 'Outside close does not restore toggle focus');
  await js("document.querySelector('.navbar-menu-toggle').click()");
  await settle();
  await viewport(1440);
  assert.equal(await menuExpanded(), 'false', 'Desktop resize does not reset menu');
  assert.equal(await js("document.querySelector('main').inert || getComputedStyle(document.body).overflow==='hidden'"), false, 'Desktop resize leaves background locked');
  await checkLayout('Settings/settings.html', 0, 1440, 1);
  await viewport(375);
  assert.equal(await menuExpanded(), 'false', 'Menu reopens after returning to compact width');
  await js("document.querySelector('.navbar-menu-toggle').focus()");
  await key('Return');
  await js("document.querySelector('.navbar-menu-toggle').focus()");
  await key('Tab');
  await key('Return');
  await waitFor(() => win.webContents.getURL().includes('/Tools/') && !win.webContents.isLoading(), 'Compact Templates link did not navigate');
  await waitFor(() => js("!!document.querySelector('nav-bar [aria-current=page]')"), 'Templates navbar not ready');
  await settle();
  assert.equal(await menuExpanded(), 'false', 'Menu does not start closed on next page');
  await checkLayout('Tools/tools.html', 0, 375, 1);
}
async function checkNavbarErase() {
  await viewport(1024);
  const opening=await js(`(async () => {
    const nav=document.querySelector('.navbar-shell'),mask=nav.querySelector('.navbar-erase-mask'),edge=nav.querySelector('.navbar-erase-edge'),steps=nav.querySelector('.navbar-steps');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const read=()=>({nav:rect(nav),mask:rect(mask),edge:rect(edge),stepsOpacity:getComputedStyle(steps).opacity,stepsVisibility:getComputedStyle(steps).visibility,edgeStyle:getComputedStyle(edge).borderLeftStyle,edgeWidth:parseFloat(getComputedStyle(edge).borderLeftWidth),shellBackground:getComputedStyle(nav).backgroundColor,shellBorder:getComputedStyle(nav).borderTopStyle,toggle:rect(nav.querySelector('.navbar-menu-toggle'))});
    const closedBackground=getComputedStyle(nav).backgroundColor;
    nav.querySelector('.navbar-menu-toggle').click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const animation=mask.getAnimations().find(a=>a.effect.getKeyframes().some(frame=>frame.transform));
    if(!animation)throw Error('Navbar erase mask has no transform animation');
    animation.pause();animation.currentTime=0;
    const start=read();
    animation.currentTime=Number(animation.effect.getTiming().duration)/2;
    const middle=read();
    window.__navbarEraseTest={animation,read};
    await Promise.all(nav.getAnimations({subtree:true}).filter(a=>a!==animation&&a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await new Promise(resolve=>setTimeout(resolve,100));
    return {closedBackground,start,middle,duration:animation.effect.getTiming().duration};
  })()`);
  assert.ok(opening.duration>0, 'Navbar erase has no duration');
  assert.ok(Math.abs(opening.start.edge.left-(opening.start.nav.right-2))<=1, 'Dotted leading edge does not start on navbar right border');
  assert.equal(opening.start.edgeStyle, 'dotted', 'Erase leading edge is not dotted');
  assert.ok(opening.start.edgeWidth>0, 'Erase leading edge has no stroke');
  assert.ok(Math.abs(opening.start.edge.top-opening.start.nav.top)<=1 && Math.abs(opening.start.edge.bottom-opening.start.nav.bottom)<=1, 'Dotted edge does not span navbar height');
  assert.ok(opening.middle.edge.left>0 && opening.middle.edge.left<opening.start.edge.left, 'Erase edge does not cross viewport');
  assert.ok(Math.abs(opening.middle.mask.left-opening.middle.edge.left)<=1, 'Dotted edge does not lead solid background');
  for(const frame of [opening.start,opening.middle]) {
    assert.equal(frame.stepsOpacity,'1','Steps disappear before erase edge reaches them');
    assert.equal(frame.stepsVisibility,'visible','Steps hide before erase edge reaches them');
    assert.equal(frame.shellBackground,opening.closedBackground,'Navbar background changes before erase passes');
    assert.equal(frame.shellBorder,'dashed','Navbar border disappears before erase passes');
    assert.equal(frame.toggle.left,opening.start.toggle.left,'Erase moves close button');
  }
  fs.writeFileSync(path.join(artifacts,'Tools-1024-erase-midpoint.png'),(await win.webContents.capturePage()).toPNG());
  const finished=await js(`(() => {const test=window.__navbarEraseTest;test.animation.finish();const result=test.read();delete window.__navbarEraseTest;return result;})()`);
  assert.ok(finished.edge.right<=0,'Dotted leading edge does not finish beyond viewport left');
  await settle();
  await checkLayout('Tools/tools.html',0,1024,1,true);
  await screenshot('Tools-1024-erase-finished');
  const closing=await js(`(async()=>{
    const mask=document.querySelector('.navbar-erase-mask');
    document.querySelector('.navbar-menu-toggle').click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const animation=mask.getAnimations().find(a=>a.effect.getKeyframes().some(frame=>frame.transform));
    if(!animation)throw Error('Navbar erase close has no reverse animation');
    animation.pause();animation.currentTime=0;const start=mask.getBoundingClientRect().left;
    animation.currentTime=Number(animation.effect.getTiming().duration)/2;const middle=mask.getBoundingClientRect().left;
    animation.finish();return{start,middle};
  })()`);
  assert.ok(closing.middle>closing.start,'Closing does not reverse navbar erase');
  await settle();
  await checkLayout('Tools/tools.html',0,1024,1);
  await js(`(async()=>{const button=document.querySelector('.navbar-menu-toggle');button.click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));button.click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));button.click();})()`);
  await settle();
  await checkLayout('Tools/tools.html',0,1024,1,true);
  await js("document.querySelector('.navbar-menu-toggle').click()");
  await settle();
  await checkLayout('Tools/tools.html',0,1024,1);
}
async function checkWipeAndReducedMotion() {
  await viewport(1024);
  const animation = await js(`(async () => {
    const panel=document.querySelector('.navbar-utilities');
    const closed=getComputedStyle(panel).clipPath;
    document.querySelector('.navbar-menu-toggle').click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {closed,animations:panel.getAnimations().map(a=>({duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes()}))};
  })()`);
  assert.match(animation.closed, /100%/, 'Closed sidebar has no wipe origin');
  assert.ok(animation.animations.some(a=>a.duration>0&&a.frames.some(f=>f.clipPath)), 'Sidebar has no clip-path wipe animation');
  await settle();
  await screenshot('Tools-1024-sidebar-wipe');
  await js("document.querySelector('.navbar-menu-toggle').click()");
  await settle();
  const inertRestore = await js(`(() => {
    const sentinel=document.createElement('div');sentinel.id='preexistingInert';sentinel.inert=true;document.body.append(sentinel);
    document.querySelector('.navbar-menu-toggle').click();
    return sentinel.inert;
  })()`);
  assert.equal(inertRestore, true);
  await settle();
  await js("document.querySelector('.navbar-menu-toggle').click()");
  await settle();
  assert.equal(await js("document.querySelector('#preexistingInert').inert"), true, 'Closing sidebar clears pre-existing inert state');
  await js("document.querySelector('#preexistingInert').remove()");
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await waitFor(() => js("matchMedia('(prefers-reduced-motion: reduce)').matches"), 'Reduced-motion media did not apply');
    await js("document.querySelector('.navbar-menu-toggle').click()");
    await settle();
    const durations=await js("[document.querySelector('.navbar-utilities'),document.querySelector('.navbar-steps'),document.querySelector('.navbar-menu-backdrop'),document.querySelector('.navbar-erase-mask'),...document.querySelectorAll('.navbar-menu-toggle svg *')].map(e=>getComputedStyle(e).transitionDuration)");
    assert.ok(durations.every(value=>value.split(',').every(duration=>parseFloat(duration)===0)), 'Sidebar ignores reduced motion: '+durations);
    await screenshot('Tools-1024-reduced-motion');
    await js("document.querySelector('.navbar-menu-toggle').click()");
    await settle();
  } finally {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[]});
    win.webContents.debugger.detach();
  }
}
async function checkCleanup() {
  await viewport(375);
  await js("document.querySelector('.navbar-menu-toggle').click()");
  await settle();
  const result = await js(`(() => {
    const nav=document.querySelector('nav-bar');
    const disconnect=ResizeObserver.prototype.disconnect;
    let disconnected=0;
    ResizeObserver.prototype.disconnect=function(){disconnected++;return disconnect.call(this);};
    nav.remove();
    ResizeObserver.prototype.disconnect=disconnect;
    const cleared=!document.documentElement.style.getPropertyValue('--navbar-height');
    const bannerRemoved=!document.querySelector('#sharedUpdateBanner');
    document.body.prepend(nav);
    return {disconnected,cleared,bannerRemoved,mainInert:document.querySelector('main').inert,overflow:getComputedStyle(document.body).overflow};
  })()`);
  assert.ok(result.disconnected > 0, 'Removed navbar keeps its ResizeObserver');
  assert.equal(result.cleared, true, 'Removed navbar keeps its measured height');
  assert.equal(result.bannerRemoved, true, 'Removed navbar keeps its update banner');
  assert.equal(result.mainInert, false, 'Removed navbar keeps the background inert');
  assert.notEqual(result.overflow, 'hidden', 'Removed navbar keeps the background scroll lock');
  await settle();
  assert.equal(await js("document.querySelectorAll('#sharedUpdateBanner').length"), 1, 'Reconnect duplicates banner');
  await checkBanner(375);
}
async function run() {
  app.commandLine.appendSwitch('disable-gpu');
  app.setPath('userData', path.join(work, 'electron'));
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  setupIpc();
  win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('Electron Security Warning')) errors.push(message); });
  for (const [page, step] of pages) {
    win.webContents.setZoomFactor(1);
    await win.loadFile(path.join(root, 'GUI', page));
    await waitFor(() => js("!!document.querySelector('nav-bar ol')"), 'Navbar did not render');
    for (const width of [1440, 1280, 1279, 1024, 768, 375]) {
      await viewport(width);
      await checkLayout(page, step, width, 1);
      await screenshot(page.split('/')[0] + '-' + width);
      if (width <= 1279) {
        await js("document.querySelector('.navbar-menu-toggle').click()");
        await settle();
        await checkLayout(page, step, width, 1, true);
        if ([1024, 375].includes(width)) await screenshot(page.split('/')[0] + '-' + width + '-menu-open');
        await js("document.querySelector('.navbar-menu-toggle').click()");
        await settle();
      }
    }
    await viewport(1440, 2);
    await js('scrollTo(0,0)');
    await settle();
    await waitFor(() => js("Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height'))-document.querySelector('nav-bar nav').getBoundingClientRect().bottom)<=1"), 'Zoom height did not update');
    await checkLayout(page, step, 1440, 2);
    await screenshot(page.split('/')[0] + '-zoom-200');
  }
  win.webContents.setZoomFactor(1);
  await win.loadFile(path.join(root, 'GUI/Home/home.html'));
  await settle();
  await checkBanner(1440);
  await checkBanner(375);
  await checkBanner(375, true);
  await checkKeyboard();
  await checkCompactMenu();
  await checkNavbarErase();
  await checkWipeAndReducedMotion();
  await checkCleanup();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(`Navbar smoke passed: six pages, six widths, 200% zoom, desktop/mobile keyboard, sidebar wipe, dotted navbar erase, reduced motion, modal focus, cleanup and update actions. Screenshots: ${artifacts}`);
  win.destroy(); app.quit();
}
run().catch(error => { console.error(error); if (win) win.destroy(); app.exit(1); });

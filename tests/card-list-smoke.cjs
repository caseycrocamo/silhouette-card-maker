'use strict';
const {app,BrowserWindow,ipcMain,session,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'card-list-smoke-'));
const constants=require('../GUI/shared/constants');
for(const [method,name] of Object.entries({getFrontDir:'front',getDoubleSidedDir:'double_sided',getDataDir:'data',getBackDir:'back',getOutputDir:'output',getDecklistDir:'decklist'})) {const dir=path.join(work,name);fs.mkdirSync(dir,{recursive:true});constants[method]=()=>dir;}
let win;const errors=[];
async function js(code){return win.webContents.executeJavaScript(code);}
async function wait(check){const until=Date.now()+10000;while(Date.now()<until){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw new Error('UI timed out: '+errors.join(' | ')+' | '+await js('document.body.innerText'));}
async function run(){
 app.commandLine.appendSwitch('disable-gpu');app.setPath('userData',path.join(work,'electron'));await app.whenReady();
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
 const cache=path.join(constants.getDataDir(),'card-cache');fs.mkdirSync(cache);
 const id='a'.repeat(32),imagePath=path.join(cache,id+'.png');
 const {nativeImage}=require('electron');fs.writeFileSync(imagePath,fs.readFileSync(path.join(root,'test/images/1_mtg.png')));
 require('../GUI/Utilities/cardWorkerClient').requestCards=async payload=>{
  if(payload.op==='parse') return {entries:[{id:'line-1',sourceLine:1,name:'Pikachu',qty:2,setCode:'SVI',number:'047'}],errors:[]};
  if(payload.op==='resolve') return {id:'tcg:SVI:047',name:'Pikachu',setCode:'SVI',number:'047',cacheId:id,faces:[{url:require('url').pathToFileURL(imagePath).href}],width:745,height:1040};
  return {released:0};
 };
 require('../GUI/Utilities/ipcHandlers');
 ipcMain.handle('updates:get-state',()=>({status:'idle'}));
 dialog.showMessageBox=async()=>({response:1});
 win=new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{nodeIntegration:true,contextIsolation:false}});
 win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});
 await win.loadFile(path.join(root,'GUI/CardList/decklist.html'),{query:{game:'pokemon'}});
 await wait(()=>js("!!document.getElementById('longText') && !document.getElementById('longText').disabled"));
 await js("document.getElementById('longText').value='2 Pikachu SVI 047';document.getElementById('longText').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('longForm').requestSubmit()");
 await wait(()=>js("!document.getElementById('nextCreatePdfBtn').disabled"));
 assert.match(await js('document.body.innerText'),/Pikachu/);
 await js("document.getElementById('longText').value='';document.getElementById('longText').dispatchEvent(new Event('input',{bubbles:true}))");
 assert.equal(await js("document.getElementById('nextCreatePdfBtn').disabled"),true);
 await js("document.getElementById('longText').value='2 Pikachu SVI 047';document.getElementById('longText').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('longForm').requestSubmit()");
 await wait(()=>js("!document.getElementById('nextCreatePdfBtn').disabled"));
 const screenshot=await win.webContents.capturePage();fs.writeFileSync(path.join(work,'pokemon.png'),screenshot.toPNG());
 await js("document.getElementById('nextCreatePdfBtn').click()");
 await wait(async()=>win.webContents.getURL().includes('/CreatePDF/'));
 assert.equal(fs.readdirSync(constants.getFrontDir()).filter(f=>f.endsWith('.png')).length,2);
 assert.equal(await js("sessionStorage.getItem('onlyFronts')"),'true');
 assert.equal(await js("sessionStorage.getItem('activeGame')"),'pokemon');
 await win.loadFile(path.join(root,'GUI/Home/home.html'));
 assert.equal(await js("document.querySelectorAll('#gamePicker button').length"),22);
 assert.equal(await js("document.querySelector('#gamePicker [data-game=pokemon]').textContent"),'Pokémon');
 assert.equal(await js("document.querySelector('#gamePicker [data-game=mtg]').textContent"),'Magic: The Gathering');
 await win.setSize(680,900); // Electron minimum; renderer widths also tested below.
 await js("document.documentElement.style.width='375px'");
 assert.ok(!errors.some(e=>e.includes('Uncaught')),errors.join('\n'));
 console.log('Card list smoke passed; artifacts: '+work);
 win.destroy();app.quit();
}
run().catch(error=>{console.error(error);if(win)win.destroy();app.exit(1);});

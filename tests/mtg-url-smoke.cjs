'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'mtg-url-'));
let win, metadata, failFetch=false;
const pending=[],requests=[];
const url='https://archidekt.com/decks/28135484/niko_light_of_hope_blink_and_youll_miss_it';
const rows=[{id:'one',name:'Bolt',qty:2,setCode:'M11',number:'146'},{id:'two',name:'Island',qty:1,setCode:'M11',number:'234'}];
const js=code=>win.webContents.executeJavaScript(code);
async function wait(check,message){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error(message+': '+await js('document.body.innerText'));}
async function shot(name){await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(path.join(work,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function type(value){await js(`document.getElementById('longText').value=${JSON.stringify(value)};document.getElementById('longText').dispatchEvent(new Event('input',{bubbles:true}));`);}
async function click(id){await js(`document.getElementById(${JSON.stringify(id)}).click()`);}
async function finishDeck(){
 await wait(()=>!!metadata,'Deck fetch started');metadata({entries:rows,errors:[]});metadata=null;
 await wait(()=>pending.length===1,'One whole-list image request');
 assert.equal(await js("document.getElementById('inputLabel').textContent"),'Deck list');
 assert.equal(await js("document.getElementById('longText').rows"),12);
 assert.equal(await js("document.getElementById('longText').value"),'2x Bolt (M11) 146\nIsland (M11) 234');
 assert.match(await js("document.getElementById('resultStatus').textContent"),/Loading cards/);
 assert.equal(requests.at(-1).format,'default');
 assert.equal(requests.at(-1).input.value,'2x Bolt (M11) 146\nIsland (M11) 234');
 const complete=pending.shift();
 complete.progress({reset:true,completed:0,total:2,entries:[],errors:[]});
 await wait(()=>js("document.getElementById('resultStatus').textContent.includes('0 of 2')"),'Initial loading count');
 complete.progress({completed:1,total:2,entries:[{...rows[0],printing:complete.printing('Bolt')}]});
 await wait(()=>js("document.querySelectorAll('#output article').length===1 && document.querySelector('#output img').complete && !document.querySelector('#output img').hidden"),'First image shown before completion');
 assert.match(await js("document.getElementById('resultStatus').textContent"),/1 of 2/);
 await js("window.firstStreamedImage=document.querySelector('#output img');void 0");
 complete.progress({completed:2,total:2,entries:[{...rows[1],printing:complete.printing('Island')}]});
 await wait(()=>js("document.querySelectorAll('#output article').length===2"),'Second image shown');
 assert.equal(await js("document.querySelector('#output img')===firstStreamedImage"),true,'New results preserve existing image nodes');
 complete();
 await wait(()=>js("!document.getElementById('nextCreatePdfBtn').disabled"),'All cards ready');
 assert.equal(await js("document.querySelector('#output img')===firstStreamedImage"),true,'Completion preserves streamed image nodes');
 assert.equal(await js("document.getElementById('resultStatus').textContent"),'2 unique cards · 3 total cards');
}
async function run(){
 app.setPath('userData',path.join(work,'electron'));await app.whenReady();
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
 ipcMain.handle('updates:get-state',()=>({enabled:false,status:'idle'}));
 const image=pathToFileURL(path.join(root,'test/images/1_mtg.png')).href;
 const backImage=pathToFileURL(path.join(root,'test/images/2_cube.jpg')).href;
 const printing=name=>({id:name,name,setCode:'M11',number:name==='Island'?'234':name==='Plains'?'230':'146',
  faces:name==='Bolt'?[{name:'Bolt front',url:image},{name:'Bolt back',url:backImage}]:[{url:image}],
  rawCard:name==='Bolt'?{id:'Bolt',name:'Bolt',set:'m11',collector_number:'146',layout:'transform'}:undefined});
 ipcMain.handle('card-request',(_e,payload)=>{
  requests.push(payload);
  if(payload.parseOnly){
   if(failFetch)return {entries:[],errors:[{message:'Deck page could not load.'}]};
   return new Promise(resolve=>{metadata=resolve;});
  }
  if(payload.input.value==='3x Bolt (M11) 146\nPlains (M11) 230')return {entries:[
   {id:'one',name:'Bolt',qty:3,setCode:'M11',number:'146',printing:printing('Bolt')},
   {id:'three',name:'Plains',qty:1,setCode:'M11',number:'230',printing:printing('Plains')}],errors:[]};
  return new Promise(resolve=>{
   const complete=()=>resolve({entries:rows.map(row=>({...row,printing:printing(row.name)})),errors:[]});
   complete.printing=printing;
   complete.progress=progress=>_e.sender.send('card-progress',{progressId:payload.progressId,progress});
   pending.push(complete);
  });
 });
 win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
 await win.loadFile(path.join(root,'GUI/CardList/decklist.html'),{query:{game:'mtg'}});
 await wait(()=>js("!document.getElementById('longText').disabled"),'Page ready');
 // Keep the independent Simple draft when importing a URL.
 await js("sessionStorage.setItem('card-list:v1:mtg:default',JSON.stringify({draft:'1 Counterspell',format:'default'}))");
 await js("document.getElementById('gameOptionsBtn').click();document.getElementById('game-option-format').value='url';document.getElementById('game-option-format').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('gameOptionsContinue').click();");
 assert.equal(await js("document.getElementById('inputLabel').textContent"),'URL');
 assert.equal(await js("document.getElementById('longText').rows"),2);
 assert.equal(await js("!document.getElementById('urlFetchOptions').hidden && [...document.querySelectorAll('#urlFetchOptions input')].length===3 && [...document.querySelectorAll('#urlFetchOptions input')].every(input=>!input.checked)"),true,'URL inclusion choices start unchecked');
 assert.equal(await js("['resultsSection','workflowSection','exportBtn','printingHint','gameOptionsSummary','changeUrlBtn'].every(id=>document.getElementById(id).hidden)"),true);
 assert.equal(await js("document.getElementById('searchBtn').disabled"),true);
 await shot('url-empty');
 await type('not a url');await js("document.getElementById('longForm').requestSubmit()");
 assert.ok(await js("document.getElementById('longText').validationMessage"));assert.equal(requests.length,0);
 await type(url);await js("document.getElementById('longForm').requestSubmit()");
 await wait(()=>!!metadata,'Deck fetch started');
 assert.deepEqual(requests.at(-1).options,{include_maybeboard:false,include_sideboard:false,tokens:false});
 assert.match(await js("document.getElementById('resultStatus').textContent"),/Fetching deck/);
 await finishDeck();
 assert.equal(await js("document.getElementById('inputLabel').textContent"),'Deck list');
 assert.equal(await js("document.getElementById('longText').rows"),12);
 assert.equal(await js("document.getElementById('longText').required"),false);
 assert.equal(await js("document.getElementById('searchBtn').textContent"),'Search cards');
 assert.equal(await js("document.getElementById('longText').value"),'2x Bolt (M11) 146\nIsland (M11) 234');
 assert.equal(await js("JSON.parse(sessionStorage.getItem('card-list:v1:mtg:default')).draft"),'1 Counterspell');
 await wait(()=>js("[...document.querySelectorAll('#output img')].every(img=>img.complete && img.naturalWidth>0 && !img.hidden)"),'Images decoded');
 assert.equal(await js(`(() => {
  const row=document.querySelector('[data-entry-id=one]');
  const flip=row.querySelector('.card-image-flip');
  const image=row.querySelector('img').getBoundingClientRect(), button=flip.getBoundingClientRect();
  return !flip.closest('button button') && !document.querySelector('#output button button') &&
   button.left>=image.left && button.top>=image.top && button.right<=image.right && button.bottom<=image.bottom &&
   image.right-button.right<12 && image.bottom-button.bottom<12;
 })()`),true,'Flip button overlays the bottom-right image corner without nested buttons');
 await js("document.querySelector('[data-entry-id=one] .card-image-flip').click()");
 await wait(()=>js("document.querySelector('[data-entry-id=one] img').alt==='Bolt back' && !document.querySelector('[data-entry-id=one] img').hidden"),'Back face shown');
 assert.equal(await js("Boolean(document.querySelector('#printingSelectorDialog[open]'))"),false,'Flip does not open the printing selector');
 await shot('url-converted');
 const beforeEdits=requests.length;
 await js("window.savedImages=[...document.querySelectorAll('#output img')];window.imageRestarts=0;document.getElementById('output').addEventListener('imageloadstart',()=>window.imageRestarts++,true)");
 await click('quantity-add-one');
 assert.equal(await js("[...document.querySelectorAll('#output img')].every((img,index)=>img===savedImages[index]) && imageRestarts===0"),true,'Adding a copy keeps every decoded image node');
 await click('quantity-remove-one');
 assert.equal(await js("[...document.querySelectorAll('#output img')].every((img,index)=>img===savedImages[index]) && imageRestarts===0"),true,'Removing a copy keeps every decoded image node');
 await click('quantity-add-one');await click('quantity-remove-two');
 assert.equal(await js("document.querySelector('[data-entry-id=one] img')===savedImages[0] && savedImages[0].alt==='Bolt back' && imageRestarts===0"),true,'Removing a card keeps the other image and its selected face');
 assert.equal(await js("document.getElementById('longText').value"),'3x Bolt (M11) 146');
 assert.equal(requests.length,beforeEdits);
 // The same textarea now accepts normal Simple card-list edits.
 const edited='3x Bolt (M11) 146\nPlains (M11) 230';
 await type(edited);await js("document.getElementById('longForm').requestSubmit()");
 await wait(()=>js("!document.getElementById('nextCreatePdfBtn').disabled"),'Edited list ready');
 assert.equal(requests.at(-1).format,'default');
 assert.equal(requests.at(-1).input.value,edited);
 assert.equal(await js("document.querySelectorAll('#output article').length"),2);
 await shot('url-edited');
 const sourceFetches=requests.filter(r=>r.parseOnly).length;
 await win.loadFile(path.join(root,'GUI/CardList/decklist.html'),{query:{game:'mtg'}});
 await wait(()=>js("!document.getElementById('nextCreatePdfBtn').disabled"),'Saved text restored');
 assert.equal(requests.filter(r=>r.parseOnly).length,sourceFetches);
 assert.equal(await js("document.getElementById('inputLabel').textContent"),'Deck list');
 assert.equal(await js("document.getElementById('longText').value"),edited);
 for(let i=0;i<3;i++)await click('quantity-remove-one');await click('quantity-remove-three');
 assert.equal(await js("document.getElementById('longText').value"),'');
 assert.equal(await js("document.getElementById('nextCreatePdfBtn').disabled"),true);
 assert.equal(await js("document.getElementById('resetUrlEditsBtn').hidden"),false);
 await click('resetUrlEditsBtn');await finishDeck();
 assert.equal(await js("document.getElementById('longText').value"),'2x Bolt (M11) 146\nIsland (M11) 234');
 assert.equal(await js("document.getElementById('resetUrlEditsBtn').hidden"),true);
 await click('changeUrlBtn');
 assert.equal(await js("[...document.querySelectorAll('#urlFetchOptions input')].every(input=>!input.checked)"),true);
 await js("for(const input of document.querySelectorAll('#urlFetchOptions input')){input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));}");
 assert.equal(await js("document.getElementById('inputLabel').textContent"),'URL');
 assert.equal(await js("document.getElementById('longText').value"),'');
 failFetch=true;await type(url);await js("document.getElementById('longForm').requestSubmit()");
 await wait(()=>js("document.getElementById('output').textContent.includes('Deck page could not load.')"),'Fetch error shown');
 assert.equal(await js("document.getElementById('inputLabel').textContent"),'URL');
 assert.equal(await js("document.getElementById('workflowSection').hidden"),true);
 assert.equal(requests.at(-1).options.include_maybeboard,true);
 assert.equal(requests.at(-1).options.include_sideboard,true);
 assert.equal(requests.at(-1).options.tokens,true);
 failFetch=false;await js("document.getElementById('longForm').requestSubmit()");
 await finishDeck();
 assert.equal(requests.at(-1).options.tokens,true,'Include tokens reaches the Simple card loader');
 assert.equal(requests.at(-1).options.include_sideboard,undefined,'Source section flags do not change the Simple cache key');
 assert.equal(await js("document.getElementById('urlFetchOptions').hidden && document.getElementById('mtg-tokens').checked"),true);
 await click('changeUrlBtn');
 assert.equal(await js("[...document.querySelectorAll('#urlFetchOptions input')].every(input=>!input.checked)"),true,'New URLs start unchecked even after a token import');
 console.log('MTG URL-to-Simple loading, shared editor, copy controls, saved text, reset and errors passed. Artifacts: '+work);
 win.destroy();app.quit();
}
run().catch(error=>{console.error(error);if(win)win.destroy();app.exit(1);});

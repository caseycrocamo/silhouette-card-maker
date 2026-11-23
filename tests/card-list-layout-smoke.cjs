'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'card-list-layout-'));
let win;
async function js(code){try{return await win.webContents.executeJavaScript(code);}catch(error){throw Error(code.slice(0,160)+': '+error.message);}}
async function wait(check,message){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(message+': '+await js('document.body.innerText'));}
async function settle(){await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
async function geometry(){await settle();await js("Promise.all(document.getElementById('longText').getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>true)");return js(`(() => {
 const editor=document.querySelector('.card-list-editor').getBoundingClientRect();
 const results=document.getElementById('resultsSection').getBoundingClientRect();
 const input=document.getElementById('longText');
 return {editor:editor.height,results:results.height,input:input.clientHeight,
   scroll:input.scrollHeight,scrollWidth:document.documentElement.scrollWidth,width:innerWidth};
})()`);}
async function run(){
 app.setPath('userData',path.join(work,'electron'));await app.whenReady();
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true}));
 ipcMain.handle('updates:get-state',()=>({enabled:false,status:'idle'}));
 const image=pathToFileURL(path.join(root,'test/images/1_mtg.png')).href;
 ipcMain.handle('card-request',(_event,payload)=>{
  const entries=payload.input.value.split('\n').filter(Boolean).map((name,index)=>({id:'row-'+index,name,qty:1,
   printing:{id:'card-'+index,name,setCode:'M11',number:String(index),custom:true,faces:[{url:image}]}}));
  return {entries,errors:[]};
 });
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
 await win.loadFile(path.join(root,'GUI/CardList/decklist.html'),{query:{game:'mtg'}});
 await wait(()=>js("!document.getElementById('longText').disabled"),'Page ready');
 const text=Array.from({length:120},(_,index)=>'Card '+index).join('\n');
 await js(`document.getElementById('longText').value=${JSON.stringify(text)};document.getElementById('longText').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('longForm').requestSubmit()`);
 await wait(()=>js("!document.getElementById('nextCreatePdfBtn').disabled"),'Cards ready');
 const tall=await geometry();
 assert.ok(tall.editor<tall.results,JSON.stringify(tall));
 assert.ok(Math.abs(tall.input-tall.scroll)<2,'The textarea ends at the final line');
 assert.ok(tall.input>1000,'Long lists use the available vertical space');
 await js("document.querySelector('#longForm details').open=true");
 const expanded=await geometry();
 assert.ok(expanded.editor<=expanded.results,JSON.stringify(expanded));
 assert.ok(Math.abs(expanded.input-tall.input)<2,'Preferences do not add blank space to the textarea');
 await js("document.querySelector('#longForm details').open=false");
 await settle();fs.writeFileSync(path.join(work,'expanded-editor.png'),(await win.webContents.capturePage()).toPNG());
 await js("document.body.appendChild(Object.assign(document.createElement('dialog'),{id:'printingSelectorDialog'}));document.getElementById('printingSelectorDialog').showModal()");
 assert.equal(await js("getComputedStyle(document.querySelector('.card-list-editor')).display"),'none','The printing drawer can still hide the editor');
 await js("document.getElementById('printingSelectorDialog').close();document.getElementById('printingSelectorDialog').remove()");
 // Fewer results shrink the editor and leave overflow inside the textarea.
 await js("document.getElementById('longText').value='One card';document.getElementById('longText').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('longForm').requestSubmit()");
 await wait(()=>js("!document.getElementById('nextCreatePdfBtn').disabled"),'Single card ready');
 const short=await geometry();
 assert.ok(short.editor<short.results,JSON.stringify(short));
 assert.ok(short.input<100,'A one-line list gets a one-line textarea');
 assert.ok(short.input<tall.input,'The editor shrinks with the results');
 await js("document.querySelector('#longForm details').open=true");
 const shortExpanded=await geometry();
 assert.ok(shortExpanded.editor<=shortExpanded.results+2,'Expanded controls stay within the results height cap');
 await js("document.querySelector('#longForm details').open=false");
 await geometry();
 const overflowText=Array.from({length:200},()=> 'Long line').join('\n');
 await js(`document.getElementById('longText').value=${JSON.stringify(overflowText)};window.dispatchEvent(new Event('resize'))`);
 const capped=await geometry();
 assert.ok(Math.abs(capped.editor-capped.results)<2,JSON.stringify(capped));
 assert.ok(capped.scroll>capped.input,'Text scrolls instead of exceeding the results height');
 await win.setSize(680,900);
 const narrow=await geometry();
 assert.ok(narrow.input<600,'Stacked pages keep the compact editor');
 assert.ok(narrow.scrollWidth<=narrow.width,'No horizontal page overflow');
 console.log('Deck list expansion, results height cap, preferences and narrow layout passed. Artifacts: '+work);
 win.destroy();app.quit();
}
run().catch(error=>{console.error(error);if(win)win.destroy();app.exit(1);});

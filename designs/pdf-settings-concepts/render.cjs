const {app,BrowserWindow}=require('electron');
const fs=require('fs');const path=require('path');const os=require('os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'settings-concepts-'));
app.setPath('userData',temp);app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1600,height:1000,useContentSize:true,webPreferences:{contextIsolation:true}});for(const name of (process.argv.includes('--combined') ? ['04-preferences-preview'] : ['01-preferences','02-tabbed-dialog','03-settings-view','04-preferences-preview'])){await win.loadFile(path.join(__dirname,name+'.html'));await win.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');fs.writeFileSync(path.join(__dirname,name+'.png'),(await win.webContents.capturePage()).toPNG());}win.destroy();app.exit(0);}).catch(e=>{console.error(e);app.exit(1)});

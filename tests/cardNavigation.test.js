const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function render(url,saved){
 let Navbar;
 class Element{getAttribute(){return '2';}}
 const current=new URL(url);
 const context={HTMLElement:Element,window:{location:current},sessionStorage:{getItem:()=>saved},URLSearchParams,__dirname:path.resolve(__dirname,'../GUI/shared'),require:name=>name==='path'?path:{},customElements:{define:(_name,klass)=>{Navbar=klass;}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../GUI/shared/navbar.js'),'utf8'),context);
 const nav=new Navbar();nav.updateContent();return nav.innerHTML;
}
test('direct card-list game takes precedence over saved navigation game',()=>{
 assert.match(render('file:///GUI/CardList/decklist.html?game=pokemon','mtg'),/decklist.html\?game=pokemon/);
 assert.match(render('file:///GUI/CardList/decklist.html?game=mtg','pokemon'),/decklist.html\?game=mtg/);
});
test('translation returns to MTG while PDF retains selected game',()=>{
 assert.match(render('file:///GUI/MagicTheGathering/text_translation.html','pokemon'),/decklist.html\?game=mtg/);
 assert.match(render('file:///GUI/CreatePDF/create.html','pokemon'),/decklist.html\?game=pokemon/);
});

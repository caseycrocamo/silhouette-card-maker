const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createImportAdapter}=require('../GUI/CardList/adapters/mtgImport');
const {createController}=require('../GUI/shared/cardList/controller');
const {loadGameOptions}=require('../GUI/shared/gameOptions');
const {getGame}=require('../GUI/shared/cardList/gameRegistry');

test('MTG exposes every CLI format and preserves default syntax',()=>{
  const formats=loadGameOptions(getGame('mtg')).formats;
  assert.deepEqual(formats.map(x=>x.id),['default','simple','mtga','mtgo','archidekt','deckstats','moxfield','cubecobra_csv','scryfall_json','mpcfill_xml','url']);
});
test('import retains original CSV and selected file across retry',async()=>{
  const requests=[]; const source='name,Set\nCustom,ltr';
  const adapter=createImportAdapter(async payload=>{requests.push(payload);return {entries:[{id:'row',name:'Custom',qty:2,printing:{id:'custom',name:'Custom',custom:true,paired:true,faces:[{url:'file:///front.png',cacheId:'a'},{url:'file:///back.png',cacheId:'b'}]}}],errors:[]};},()=>({tokens:true}));
  adapter.setFormat('cubecobra_csv'); adapter.setInput({kind:'file',value:'/déck.csv'});
  const controller=createController({adapter}); await controller.search(source); await controller.search(source,true);
  assert.equal(controller.state.draft,source); assert.equal(requests[1].input.value,'/déck.csv');
  assert.equal(adapter.exportPlan(controller.state.entries,'double_sided').length,2);
  assert.equal(adapter.exportPlan(controller.state.entries,'double_sided')[0].back.cacheId,'b');
});
test('custom printing and failed rows stay distinct and retry replaces results',async()=>{
  let attempts=0;
  const adapter=createImportAdapter(async()=>({entries:++attempts===1?[{id:'failed',name:'Island',qty:3,error:'offline'}]:[{id:'ready',name:'Island',qty:3,printing:{id:'one',name:'Island',faces:[{url:'file:///a.png'}]}}],errors:[]}),()=>({}));
  adapter.setFormat('mtgo'); const controller=createController({adapter}); await controller.search('3 Island');
  assert.equal(controller.state.status,'error'); await controller.search('3 Island',true);
  assert.equal(controller.state.status,'ready'); assert.equal(controller.state.entries.length,1); assert.equal(controller.state.entries[0].qty,3);
});
test('preference changes keep the manual printing visible but stale until search',async()=>{
  const adapter=createImportAdapter(async()=>({entries:[],errors:[]}),()=>({}));
  const {createAdapter}=require('../GUI/CardList/adapters/mtg');
  const printing={id:'chosen',name:'Bolt',setCode:'M11',number:'146',faces:[{url:'https://cards.scryfall.io/bolt.png'}]};
  const controller=createController({adapter:{parse:()=>({entries:[{id:'row',name:'Bolt',qty:2}],errors:[]}),resolve:()=>printing,serialize:()=> '2 Bolt (M11) 146'}});
  await controller.search('2 Bolt');controller.stale();
  assert.equal(controller.state.entries[0].printing,printing);assert.equal(controller.state.status,'dirty');assert.equal(controller.canExport(),false);
});
test('retry keeps a manual printing on an already resolved imported row',async()=>{
  let attempts=0;
  const source={id:'old',name:'Bolt',setCode:'M11',number:'146',faces:[{url:'https://cards.scryfall.io/old.png'}]};
  const adapter=createImportAdapter(async()=>({entries:[{id:'one',name:'Bolt',qty:2,printing:source},{id:'two',name:'Island',qty:1,...(++attempts===1?{error:'offline'}:{printing:source})}],errors:[]}),()=>({}));adapter.setFormat('mtgo');
  const controller=createController({adapter});await controller.search('2 Bolt\n1 Island');
  const manual={...source,id:'manual',number:'147'};controller.state.entries[0].printing=manual;
  await controller.search('2 Bolt\n1 Island',true);assert.equal(controller.state.entries[0].printing.id,'manual');
});

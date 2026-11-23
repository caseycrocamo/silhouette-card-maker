const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createImportAdapter}=require('../GUI/CardList/adapters/mtgImport');
const {createController}=require('../GUI/shared/cardList/controller');
const {loadGameOptions}=require('../GUI/shared/gameOptions');
const {getGame}=require('../GUI/shared/cardList/gameRegistry');

test('MTG combines text formats into Simple (recommended) and keeps structured imports',()=>{
  const formats=loadGameOptions(getGame('mtg')).formats;
  assert.deepEqual(formats.map(x=>x.id),['default','cubecobra_csv','scryfall_json','mpcfill_xml','url']);
  assert.equal(formats[0].label,'Simple (recommended)');
});
test('Simple (recommended) always uses the worker parser, with or without preferences',async()=>{
  const requests=[];
  const adapter=createImportAdapter(async payload=>{requests.push(payload);return {entries:[],errors:[]};},()=>({}));
  await adapter.parse('Deck\n2 [M11#146] Lightning Bolt');
  assert.equal(requests.length,1);
  assert.equal(requests[0].format,'default');
  assert.equal(requests[0].input.value,'Deck\n2 [M11#146] Lightning Bolt');
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


test('URL imports convert to text then send the same whole-list request as Simple',async()=>{
  const requests=[],handOff=[];
  const text='2x Bolt (M11) 146\nIsland (M11) 234';
  const entries=[{id:'one',name:'Bolt',qty:2,setCode:'m11',number:'146'},
    {id:'two',name:'Island',qty:1,setCode:'m11',number:'234'}];
  const request=async payload=>{
    requests.push(payload);
    return {entries:payload.parseOnly?entries:entries.map(entry=>({...entry,printing:{
      id:entry.id,name:entry.name,setCode:entry.setCode.toUpperCase(),number:entry.number,faces:[{url:'file:///card.png'}]}})),errors:[]};
  };
  const adapter=createImportAdapter(request,()=>({}),()=>({}),value=>handOff.push({...value,requests:requests.length}));
  adapter.setFormat('url');
  const controller=createController({adapter});
  await controller.search('https://archidekt.com/decks/28135484/example');
  assert.equal(requests[0].parseOnly,true);
  assert.equal(requests.length,2);
  assert.deepEqual(handOff,[{url:'https://archidekt.com/decks/28135484/example',text,requests:1}]);
  assert.equal(controller.state.draft,text);
  assert.equal(controller.state.status,'ready');
  const urlRequest=requests[1];
  const simple=createImportAdapter(request,()=>({}));
  await simple.parse(text);
  assert.deepEqual(requests[2],urlRequest);
});

test('URL imports with tokens also use the Simple whole-list path',async()=>{
  const requests=[];
  const adapter=createImportAdapter(async request=>{
    requests.push(request);
    return request.parseOnly?{entries:[{id:'one',name:'Bolt',qty:2}],errors:[]}:
      {entries:[{id:'one',name:'Bolt',qty:2,printing:{id:'bolt',name:'Bolt',faces:[{url:'file:///front.png'}]}},
      {id:'token',name:'Token',qty:2,token:true,printing:{id:'token',name:'Token',faces:[{url:'file:///token.png'}]}}],errors:[]};
  },()=>({tokens:true}));
  adapter.setFormat('url');
  const result=await adapter.parse('https://moxfield.com/decks/test');
  assert.equal(requests.length,2);
  assert.equal(requests[0].parseOnly,true);
  assert.equal(requests[1].format,'default');
  assert.equal(requests[1].input.value,'2x Bolt');
  assert.equal(requests[1].options.tokens,true);
  assert.equal(result.entries[1].token,true);
});

test('large URL decks need only one metadata request and one Simple import',async()=>{
  const requests=[];
  const entries=Array.from({length:95},(_,index)=>({id:String(index),name:'Card '+index,qty:1}));
  const adapter=createImportAdapter(async payload=>{
    requests.push(payload);
    return {entries:payload.parseOnly?entries:entries.map(entry=>({...entry,printing:{id:entry.id,name:entry.name,faces:[{url:'file:///card.png'}]}})),errors:[]};
  },()=>({}));
  adapter.setFormat('url');
  const controller=createController({adapter});
  await controller.search('https://archidekt.com/decks/28135484/example');
  assert.equal(requests.length,2);
  assert.equal(requests[1].input.value.split('\n').length,95);
  assert.equal(controller.state.entries.length,95);
});

test('editing a pending URL prevents the handoff and image import',async()=>{
  let finish;
  const requests=[],handoffs=[];
  const adapter=createImportAdapter(payload=>{requests.push(payload);return new Promise(resolve=>{finish=resolve;});},()=>({}),()=>({}),value=>handoffs.push(value));
  adapter.setFormat('url');
  const controller=createController({adapter});
  const loading=controller.search('https://moxfield.com/decks/old');
  controller.dirty('https://moxfield.com/decks/new');
  finish({entries:[{id:'one',name:'Bolt',qty:1}],errors:[]});
  await loading;
  assert.equal(handoffs.length,0);
  assert.equal(requests.length,1);
  assert.equal(controller.state.draft,'https://moxfield.com/decks/new');
});

test('URL metadata errors do not import an incomplete list',async()=>{
  const requests=[];
  const adapter=createImportAdapter(async payload=>{requests.push(payload);return {entries:[{id:'one',name:'Bolt',qty:1}],errors:[{message:'Failed to read the rest of the deck'}]};},()=>({}));
  adapter.setFormat('url');
  const result=await adapter.parse('https://moxfield.com/decks/test');
  assert.equal(requests.length,1);
  assert.equal(result.entries.length,0);
  assert.equal(result.errors.length,1);
});

test('copy buttons cannot edit entries during a search',async()=>{
  const adapter=createImportAdapter(async()=>({entries:[{id:'one',name:'Bolt',qty:1,
    printing:{id:'bolt',name:'Bolt',faces:[{url:'file:///card.png'}]}}],errors:[]}),()=>({}));
  const controller=createController({adapter});
  await controller.search('Bolt');
  const entry=controller.state.entries[0];
  const searching=controller.search('Bolt');
  assert.equal(controller.changeQuantity(entry,1),false);
  await searching;
  assert.equal(controller.state.entries[0].qty,1);
});

test('shared imports expose progress before completion and preserve streamed cards',async()=>{
  let finish, emit;
  const printing={id:'one',name:'Bolt',faces:[{url:'file:///one.png'}]};
  const adapter=createImportAdapter((_payload,onProgress)=>{emit=onProgress;return new Promise(resolve=>{finish=resolve;});},()=>({}));
  const controller=createController({adapter});
  const loading=controller.search('Bolt\nIsland');
  emit({reset:true,completed:0,total:2,entries:[],errors:[]});
  emit({completed:1,total:2,entries:[{id:'one',name:'Bolt',qty:1,printing}]});
  const first=controller.state.entries[0];
  assert.equal(controller.state.status,'loading');
  assert.equal(controller.state.progress.total,2);
  assert.equal(first.status,'ready');
  assert.equal(controller.canExport(),false);
  finish({entries:[{id:'one',name:'Bolt',qty:1,printing:structuredClone(printing)},
    {id:'two',name:'Island',qty:1,printing:{id:'two',name:'Island',faces:[{url:'file:///two.png'}]}}],errors:[]});
  await loading;
  assert.equal(controller.state.entries[0],first);
  assert.equal(controller.state.entries[0].printing,printing);
  assert.equal(controller.state.status,'ready');
  assert.equal(controller.state.progress,null);
});

test('progress from an edited or canceled list cannot change the new draft',async()=>{
  let finish,emit;
  const adapter=createImportAdapter((_payload,onProgress)=>{emit=onProgress;return new Promise(resolve=>{finish=resolve;});},()=>({}));
  const controller=createController({adapter});
  const loading=controller.search('Bolt');
  controller.dirty('Island');
  emit({reset:true,completed:0,total:1,entries:[]});
  emit({completed:1,total:1,entries:[{id:'old',name:'Bolt',qty:1,printing:{id:'old',faces:[]}}]});
  finish({entries:[],errors:[]});await loading;
  assert.equal(controller.state.draft,'Island');
  assert.equal(controller.state.entries.length,0);
  assert.equal(controller.state.progress,null);
});

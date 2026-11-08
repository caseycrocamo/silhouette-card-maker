'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fetchPrintings,createPrintingPager,getPrintingKey,getPrintingImages,getPrintingTreatment} = require('../GUI/MagicTheGathering/printingSelector');
const url = 'https://api.scryfall.com/cards/search?page=1';
const printing = (number, extra={}) => ({set:'cmm',collector_number:number,...extra});
const response = data => ({ok:true,json:async()=>data});
test('printing page size defaults to 25 and saved sizes survive a new reader', () => {
 const {readPageSize,savePageSize}=require('../GUI/shared/printingPreferences');
 const values=new Map();
 const storage={getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value)};
 assert.equal(readPageSize(storage),25);
 savePageSize('7',storage);
 assert.equal(readPageSize({...storage}),7);
});
test('invalid printing sizes keep the saved preference and corrupt storage uses the default', () => {
 const {readPageSize,savePageSize,STORAGE_KEY}=require('../GUI/shared/printingPreferences');
 const values=new Map([[STORAGE_KEY,'50']]);
 const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 for(const value of ['',0,-1,1.5,201,'invalid'])assert.throws(()=>savePageSize(value,storage),/whole number/);
 assert.equal(readPageSize(storage),50);
 values.set(STORAGE_KEY,'invalid');
 assert.equal(readPageSize(storage),25);
 assert.equal(readPageSize({getItem:()=>{throw Error('unavailable');}}),25);
});
test('printing batches defer later API pages until the next 25 are needed', async () => {
 const requested=[];
 const cards=Array.from({length:60},(_,i)=>printing(String(i+1),{id:String(i)}));
 const pager=createPrintingPager({prints_search_uri:url},{fetchImpl:async address=>{
  requested.push(address);
  return address===url?response({data:cards.slice(0,30),has_more:true,next_page:'https://api.scryfall.com/cards/search?page=2'}):response({data:cards.slice(30),has_more:false});
 }});
 let batch=await pager.load(25);
 assert.equal(requested.length,1);
 assert.equal(batch.choices.length,30);
 assert.equal(batch.hasMore,true);
 batch=await pager.load(50);
 assert.equal(requested.length,2);
 assert.equal(batch.choices.length,60);
 assert.equal(batch.hasMore,false);
 await pager.load(75);
 assert.equal(requested.length,2);
});
test('a failed later page can be retried without losing earlier printings', async () => {
 let fail=true;
 const pager=createPrintingPager({prints_search_uri:url},{fetchImpl:async address=>{
  if(address===url)return response({data:Array.from({length:25},(_,i)=>printing(String(i+1))),has_more:true,next_page:'https://api.scryfall.com/cards/search?page=2'});
  if(fail){fail=false;throw Error('offline');}
  return response({data:[printing('26')],has_more:false});
 }});
 assert.equal((await pager.load(25)).choices.length,25);
 await assert.rejects(pager.load(50),/offline/);
 const batch=await pager.load(50);
 assert.equal(batch.choices.length,26);
 assert.equal(batch.hasMore,false);
});
test('all result pages retain distinct collector numbers from one set and deduplicate exact IDs', async () => {
 const first=printing('396',{id:'regular'}), second=printing('659',{id:'borderless'});
 const requested=[];
 const result=await fetchPrintings({prints_search_uri:url},{fetchImpl:async address=>{requested.push(address);return address===url?response({data:[first],has_more:true,next_page:'https://api.scryfall.com/cards/search?page=2'}):response({data:[first,second],has_more:false});}});
 assert.deepEqual(result,[first,second]);assert.equal(requested.length,2);
 assert.notEqual(getPrintingKey(first),getPrintingKey(second));
 assert.notEqual(getPrintingKey(printing('396')),getPrintingKey(printing('659')));
});
test('pagination fails clearly for cycles, missing pages, malformed results, and HTTP errors', async () => {
 for(const payload of [{data:[],has_more:true,next_page:url},{data:[],has_more:true},{data:null}]) {
  await assert.rejects(fetchPrintings({prints_search_uri:url},{fetchImpl:async()=>response(payload)}));
 }
 await assert.rejects(fetchPrintings({prints_search_uri:url},{fetchImpl:async()=>({ok:false})}),/Unable to load/);
});
test('printing results reject foreign endpoints before requesting them', async () => {
 let count=0;
 await assert.rejects(fetchPrintings({prints_search_uri:'https://example.com/cards/search'},{fetchImpl:async()=>{count++;}}),/Invalid/);
 assert.equal(count,0);
 await assert.rejects(fetchPrintings({prints_search_uri:url},{fetchImpl:async()=>{count++;return response({data:[],has_more:true,next_page:'https://example.com/cards/search'});}}),/Invalid/);
 assert.equal(count,1);
});
test('cancelled loads stop before starting another page', async () => {
 const controller=new AbortController();let requests=0;
 await assert.rejects(fetchPrintings({prints_search_uri:url},{signal:controller.signal,fetchImpl:async()=>{requests++;controller.abort();return response({data:[],has_more:true,next_page:'https://api.scryfall.com/cards/search?page=2'});}}),{name:'AbortError'});
 assert.equal(requests,1);
});
test('two-face previews use both approved image URLs and reject unsafe sources',()=>{
 assert.deepEqual(getPrintingImages({card_faces:[{image_uris:{normal:'https://cards.scryfall.io/front.png'}},{image_uris:{png:'https://cards.scryfall.io/back.png'}}]}),['https://cards.scryfall.io/front.png','https://cards.scryfall.io/back.png']);
 for(const source of ['javascript:alert(1)','file:///etc/passwd','https://example.com/card.png'])assert.deepEqual(getPrintingImages({image_uris:{normal:source}}),[]);
});
test('treatment labels distinguish borderless, showcase, retro, and regular printings',()=>{
 assert.equal(getPrintingTreatment({border_color:'borderless'}),'Borderless');
 assert.equal(getPrintingTreatment({frame_effects:['showcase']}),'Showcase');
 assert.equal(getPrintingTreatment({frame:'1997'}),'Retro frame');
 assert.equal(getPrintingTreatment({}),'Regular');
});

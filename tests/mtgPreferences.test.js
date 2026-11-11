const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validatePreferences}=require('../GUI/shared/cardList/mtgPreferences');
const {createStore}=require('../GUI/shared/cardList/sessionStore');
test('preferences preserve ordered lists, reject UB conflict and bad language',()=>{
  assert.deepEqual(validatePreferences({prefer_set:'LTR, m11, ltr',prefer_lang:'jp en'}).prefer_set,['ltr','m11']);
  assert.deepEqual(validatePreferences({prefer_lang:'jp en'}).prefer_lang,['jp','en']);
  assert.throws(()=>validatePreferences({prefer_ub:true,ignore_ub:true})); assert.throws(()=>validatePreferences({prefer_lang:'xx'}));
});
test('preferences survive format-scoped session writes',()=>{
  const map=new Map();const storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
  const store=createStore(storage,'mtg');store.save('source','double_sided',{format:'mtgo',mtgPreferences:{tokens:true}});
  store.save('edited','double_sided',{format:'mtgo'});
  assert.equal(store.load('mtgo').mtgPreferences.tokens,true);
});

"use strict";
const {createAdapter}=require('./mtg');
function createImportAdapter(request, readOptions) {
  const legacy=createAdapter();
  let format='default', source='', currentInput=null;
  return {
    ...legacy,
    reimportOnRetry:true,
    preserveResolvedOnRetry:true,
    setFormat(value){format=value; currentInput=null;},
    setInput(value){currentInput=value;},
    clearSource(){currentInput=null;},
    async parse(value){
      const preferences=readOptions();
      if(format==='default' && !Object.values(preferences).some(x=>Array.isArray(x)?x.length:!!x)) return legacy.parse(value);
      const input=currentInput || {kind:format==='url'?'url':'text',value};
      const result=await request({op:'import',game:'mtg',format,input,options:readOptions()});
      source=value;
      return {entries:result.entries,errors:result.errors,warnings:result.warnings};
    },
    resolve(entry){if(entry.printing)return Promise.resolve(entry.printing); if(!entry.error)return legacy.resolve(entry); throw new Error(entry.error);},
    serialize(entries){return format==='default' ? legacy.serialize(entries.filter(e=>!e.token)) : source;},
    exportPlan(entries,workflow){return legacy.exportPlan(entries,workflow);},
  };
}
module.exports={createImportAdapter};

"use strict";
const {createAdapter}=require('./mtg');
function createImportAdapter(request, readOptions, readQuantities = () => ({}), onUrlImported = () => {}) {
  const legacy=createAdapter(undefined, request);
  let format='default', source='', currentInput=null;
  function importList(format, input, options, onProgress) {
    return request({op:'import',game:'mtg',format,input,options}, onProgress);
  }
  return {
    ...legacy,
    reimportOnRetry:true,
    preserveResolvedOnRetry:true,
    setFormat(value){format=value; currentInput=null;},
    setInput(value){currentInput=value;},
    clearSource(){currentInput=null;},
    async parse(value,{isCurrent = () => true, onProgress} = {}){
      const preferences=readOptions();
      let input=currentInput || {kind:format==='url'?'url':'text',value};
      let importFormat=format;
      let warnings=[];
      if(format==='url') {
        const fetched=await request({op:'import',game:'mtg',format:'url',input,options:preferences,parseOnly:true});
        if(!isCurrent())return {entries:[],errors:[]};
        if(fetched.errors?.length)return {entries:[],errors:fetched.errors,warnings:fetched.warnings};
        if(!fetched.entries?.length)return {entries:[],errors:[{message:'No cards were imported'}],warnings:fetched.warnings};
        const quantities=readQuantities(value);
        const entries=fetched.entries.map(entry=>{
          const key=JSON.stringify([entry.id,entry.name,entry.setCode || '',entry.number || '']);
          const quantity=quantities[key];
          return {...entry,setCode:(entry.setCode || '').toUpperCase(),
            qty:Number.isSafeInteger(quantity) && quantity>=0 ? quantity : entry.qty};
        }).filter(entry=>entry.qty>0);
        const text=legacy.serialize(entries);
        onUrlImported({url:value,text});
        input={kind:'text',value:text};
        importFormat='default';
        warnings=fetched.warnings || [];
        if(!entries.length)return {entries:[],errors:[],warnings};
      }
      // A URL only supplies text. Card lookup, images, tokens and caching all
      // use the same whole-list request as Simple.
      const lookupOptions={...preferences};
      delete lookupOptions.include_maybeboard;
      delete lookupOptions.include_sideboard;
      const result=await importList(importFormat,input,lookupOptions,onProgress);
      source=importFormat==='default' ? input.value : value;
      return {entries:result.entries,errors:result.errors,warnings:[...warnings,...(result.warnings || [])]};
    },
    resolve(entry){if(entry.printing)return Promise.resolve(entry.printing); if(!entry.error)return legacy.resolve(entry); throw new Error(entry.error);},
    serialize(entries){return ['default','url'].includes(format) ? legacy.serialize(entries.filter(e=>!e.token)) : source;},
    exportText(entries){return this.serialize(entries);},
    exportPlan(entries,workflow){return legacy.exportPlan(entries,workflow);},
  };
}
module.exports={createImportAdapter};

"use strict";
const BOOLEAN_OPTIONS = {
  ignore_set_and_collector_number: "Ignore supplied set and collector number",
  prefer_older_sets: "Prefer older sets", prefer_showcase: "Prefer showcase",
  prefer_extra_art: "Prefer extra art", prefer_ub: "Prefer Universes Beyond",
  ignore_ub: "Exclude Universes Beyond", tokens: "Include related tokens",
};
const LIST_OPTIONS = { prefer_set: "Preferred sets, in order", ignore_set: "Excluded sets", prefer_lang: "Languages, in order (en, sp, fr, de, it, pt, jp, kr, ru, cs, ct, ag, ph)" };
function validatePreferences(value = {}) {
  const result = {};
  for (const key of Object.keys(BOOLEAN_OPTIONS)) result[key] = !!value[key];
  for (const key of Object.keys(LIST_OPTIONS)) result[key] = [...new Set((Array.isArray(value[key]) ? value[key] : String(value[key] || "").split(/[\s,]+/)).map(x => x.trim().toLowerCase()).filter(Boolean))];
  if (result.prefer_ub && result.ignore_ub) throw new Error("Choose either prefer or exclude Universes Beyond.");
  if (result.prefer_lang.some(x => !['en','sp','fr','de','it','pt','jp','kr','ru','cs','ct','ag','ph'].includes(x))) throw new Error("Enter a supported language code.");
  return result;
}
function mountPreferences(host, value, onChange) {
  const doc = host.ownerDocument;
  const details = doc.createElement('details');
  const summary = doc.createElement('summary'); summary.textContent = 'MTG selection preferences'; details.append(summary);
  const help = doc.createElement('p'); help.className='text-sm text-content-light';
  help.textContent='Supplied set and collector number take priority unless ignored. English is the language fallback. Apply preferences, then search again. Custom images keep their source art.'; details.append(help);
  const controls={};
  for (const [key, caption] of Object.entries({...BOOLEAN_OPTIONS,...LIST_OPTIONS})) {
    const label=doc.createElement('label'); label.className='block mt-2';
    const input=doc.createElement('input'); input.id='mtg-'+key;
    if (BOOLEAN_OPTIONS[key]) { input.type='checkbox'; input.checked=!!value[key]; label.append(input,doc.createTextNode(' '+caption)); }
    else { input.type='text'; input.className='paper-input'; input.value=(value[key]||[]).join(', '); label.append(doc.createTextNode(caption),input); }
    controls[key]=input; details.append(label);
  }
  const error=doc.createElement('p'); error.setAttribute('role','alert'); details.append(error);
  const {createButton}=require('../button');
  details.append(createButton({text:'Apply preferences',size:'compact',onClick:()=>{
    try { const options={}; for(const [key,input] of Object.entries(controls)) options[key]=BOOLEAN_OPTIONS[key]?input.checked:input.value;
      const result=validatePreferences(options); onChange(result); error.textContent='Preferences applied. Search again.';
    } catch(e) {error.textContent=e.message;}
  }},doc));
  details.append(createButton({text:'Reset preferences',size:'compact',onClick:()=>{
    for(const [key,input] of Object.entries(controls)) { if(BOOLEAN_OPTIONS[key]) input.checked=false; else input.value=''; }
    onChange(validatePreferences()); error.textContent='Preferences reset. Search again.';
  }},doc));
  host.append(details);
}
module.exports={validatePreferences,mountPreferences};

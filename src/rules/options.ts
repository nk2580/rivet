import { useEffect,useState } from 'react';
import { z } from 'zod';
import type { RulesetId } from '@/domain/schema';
import { packSchema,referenceBlockSchema } from './spells';

const feature=z.object({id:z.string().min(1),name:z.string().min(1),description:z.string(),page:z.number().int().positive().optional(),level:z.number().int().min(1).max(20).optional()});
export const optionSchema=feature.omit({level:true}).extend({document:z.string().optional(),blocks:z.array(referenceBlockSchema).optional(),hitDie:z.number().int().min(4).max(12).optional(),endPage:z.number().int().positive().optional(),features:z.array(feature).optional()});
export const optionsPackSchema=packSchema.omit({spells:true}).extend({classes:z.array(optionSchema),prestigeClasses:z.array(optionSchema).default([]),species:z.array(optionSchema),backgrounds:z.array(optionSchema),feats:z.array(optionSchema)});
export type CharacterOption=z.infer<typeof optionSchema>;
export type OptionsPack=z.infer<typeof optionsPackSchema>;
export type OptionGroup='classes'|'prestigeClasses'|'species'|'backgrounds'|'feats';
const paths:Record<RulesetId,string>={'5e-2014':'5.1','5e-2024':'5.2.1','3.5e':'3.5'};
const pending=new Map<RulesetId,Promise<OptionsPack>>();
export async function loadOptionsPack(edition:RulesetId){
  let promise=pending.get(edition);
  if(!promise){promise=(async()=>{
    const response=await fetch(`/rules/srd-${paths[edition]}-options.json`);
    if(!response.ok)throw new Error('Character options could not load. Connect once to save the reference offline.');
    const pack=optionsPackSchema.parse(await response.json());
    if(pack.edition!==edition||(['classes','prestigeClasses','species','backgrounds','feats'] as const).some(group=>new Set(pack[group].map(option=>option.id)).size!==pack[group].length))throw new Error('The character reference failed its edition or identity check. Update Rivet and try again.');
    return pack;
  })();pending.set(edition,promise);promise.catch(()=>pending.delete(edition));}
  return promise;
}
export function useOptionsPack(edition:RulesetId){
  const [pack,setPack]=useState<OptionsPack|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let cancelled=false;setError('');void loadOptionsPack(edition).then(value=>{if(!cancelled)setPack(value);}).catch(failure=>{if(!cancelled)setError(failure instanceof Error?failure.message:'Character options unavailable.');});return()=>{cancelled=true;};},[edition,attempt]);
  return {pack:pack?.edition===edition?pack:null,error,retry:()=>setAttempt(value=>value+1)};
}
export function searchOptions(options:CharacterOption[],query:string){
  const terms=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return options.filter(option=>terms.every(term=>(option.name+' '+option.description).normalize('NFKC').toLocaleLowerCase().includes(term))).sort((a,b)=>Number(!a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))-Number(!b.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))||a.name.localeCompare(b.name));
}

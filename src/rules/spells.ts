import { useEffect, useState } from 'react';
import { z } from 'zod';
import { spellSchema,type CharacterSpell,type RulesetId } from '@/domain/schema';

export const referenceBlockSchema=z.discriminatedUnion('type',[z.object({type:z.literal('paragraph'),text:z.string()}),z.object({type:z.literal('table'),rows:z.array(z.array(z.string()))})]);
const spellReferenceSchema=z.object({id:z.string(),name:z.string(),level:z.number().int().min(0).max(9),school:z.string(),classes:z.array(z.string()),classLevels:z.record(z.string(),z.number().int().min(0).max(9)).optional(),castingTime:z.string(),range:z.string(),components:z.string(),duration:z.string(),concentration:z.boolean(),ritual:z.boolean(),description:z.string().min(1).max(100000),page:z.number().int().positive().optional(),document:z.string().optional(),metadata:z.record(z.string(),z.string()).optional(),baseSpellId:z.string().optional(),aliases:z.array(z.string()).default([]),blocks:z.array(referenceBlockSchema).optional()});
export const packSchema=z.object({schemaVersion:z.literal(1),edition:z.enum(['5e-2014','5e-2024','3.5e']),version:z.string(),sourceUrl:z.url(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),license:z.string(),licenseUrl:z.union([z.url(),z.literal('/rules/OGL-1.0a.txt')]),attribution:z.string(),modifications:z.string(),spells:z.array(spellReferenceSchema)});
export type SpellReference=z.infer<typeof spellReferenceSchema>;
export type SpellPack=z.infer<typeof packSchema>;
const paths:Record<RulesetId,string>={'5e-2014':'srd-5.1-spells.json','5e-2024':'srd-5.2.1-spells.json','3.5e':'srd-3.5-spells.json'};
const pending=new Map<RulesetId,Promise<SpellPack>>();
export const spellNameKey=(name:string)=>name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const findSpell=(pack:SpellPack,idOrName:string)=>pack.spells.find(entry=>entry.id===spellNameKey(idOrName)||entry.aliases.some(name=>spellNameKey(name)===spellNameKey(idOrName)));
export function spellFromReference(reference:SpellReference,castingClass:string):CharacterSpell{
  if(reference.classLevels&&reference.classLevels[castingClass]===undefined)throw new Error('Choose a source casting class for this 3.5e spell.');
  return spellSchema.parse({id:crypto.randomUUID(),name:reference.name,level:reference.classLevels?.[castingClass]??reference.level,castingTime:reference.castingTime,range:reference.range,concentration:reference.concentration,prepared:false,notes:'',sourceId:reference.id,...(castingClass?{castingClass}:{} )});
}
export async function loadSpellPack(edition:RulesetId):Promise<SpellPack>{
  if(!paths[edition])throw new Error('The reference pack for this edition is still being prepared. Your sheet notes are retained.');
  let promise=pending.get(edition);
  if(!promise){promise=(async()=>{
    const response=await fetch(`/rules/${paths[edition]}`);if(!response.ok)throw new Error('The spell reference could not load. Check your connection and try again.');
    const pack=packSchema.parse(await response.json());if(pack.edition!==edition||new Set(pack.spells.map(spell=>spell.id)).size!==pack.spells.length)throw new Error('The spell reference failed its edition or identity check.');
    return pack;
  })();pending.set(edition,promise);promise.catch(()=>pending.delete(edition));}
  return promise;
}
export function useSpellPack(edition:RulesetId){
  const [pack,setPack]=useState<SpellPack|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let cancelled=false;setPack(null);setError('');void loadSpellPack(edition).then(value=>{if(!cancelled)setPack(value);}).catch(failure=>{if(!cancelled)setError(failure instanceof Error?failure.message:'Spell reference unavailable.');});return()=>{cancelled=true;};},[edition,attempt]);
  return {pack,error,retry:()=>setAttempt(value=>value+1)};
}

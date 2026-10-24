import { useEffect,useState } from 'react';
import { z } from 'zod';
import { armorDataSchema,EQUIPMENT_CATEGORIES,inventoryItemSchema,weaponDataSchema,type InventoryItem,type RulesetId } from '@/domain/schema';
import { packSchema } from './spells';

const equipmentDescriptionSchema=z.object({id:z.string(),name:z.string().min(1),group:z.string(),page:z.number().int().positive().optional(),document:z.string().optional(),description:z.string().min(1)});
const equipmentReferenceSchema=equipmentDescriptionSchema.extend({category:z.enum(EQUIPMENT_CATEGORIES),weight:z.number().min(0),weightKnown:z.boolean().default(true),cost:z.string(),costGp:z.number().min(0).nullable(),mastery:z.string().optional(),weapon:weaponDataSchema.optional(),armor:armorDataSchema.optional()});
export const equipmentPackSchema=packSchema.omit({spells:true}).extend({items:z.array(equipmentReferenceSchema),references:z.array(equipmentDescriptionSchema).default([])});
export type EquipmentReference=z.infer<typeof equipmentReferenceSchema>;
export type EquipmentPack=z.infer<typeof equipmentPackSchema>;
export type EquipmentDescription=z.infer<typeof equipmentDescriptionSchema>;
const referenceKey=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/\barmour\b/g,'armor').replace(/[^a-z0-9]/g,'');
export function findEquipmentReference(pack:EquipmentPack,item:Pick<InventoryItem,'name'|'sourceId'>):EquipmentDescription|undefined{
  const entries=[...pack.items,...pack.references];
  const explicit=item.sourceId?entries.find(entry=>entry.id===item.sourceId):undefined;if(explicit)return explicit;
  const original=referenceKey(item.name),key=original==='gogglesofthenight'?'gogglesofnight':original;
  return entries.find(entry=>referenceKey(entry.name)===key)||pack.items.find(entry=>entry.category==='armor'&&referenceKey(entry.name).replace(/armor$/,'')===key.replace(/armor$/,''));
}
const paths:Record<RulesetId,string>={'5e-2014':'srd-5.1-equipment.json','5e-2024':'srd-5.2.1-equipment.json','3.5e':'srd-3.5-equipment.json'};
const pending=new Map<RulesetId,Promise<EquipmentPack>>();
export async function loadEquipmentPack(edition:RulesetId){
  let promise=pending.get(edition);
  if(!promise){promise=(async()=>{const response=await fetch(`/rules/${paths[edition]}`);if(!response.ok)throw new Error('The equipment reference could not load. Try again when the app is connected.');const pack=equipmentPackSchema.parse(await response.json());if(pack.edition!==edition||new Set(pack.items.map(item=>item.id)).size!==pack.items.length)throw new Error('The equipment catalogue failed its edition or identity check.');return pack;})();pending.set(edition,promise);promise.catch(()=>pending.delete(edition));}
  return promise;
}
export function useEquipmentPack(edition:RulesetId){
  const [pack,setPack]=useState<EquipmentPack|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let cancelled=false;setPack(null);setError('');void loadEquipmentPack(edition).then(value=>{if(!cancelled)setPack(value);}).catch(failure=>{if(!cancelled)setError(failure instanceof Error?failure.message:'Equipment reference unavailable.');});return()=>{cancelled=true;};},[edition,attempt]);
  return {pack,error,retry:()=>setAttempt(value=>value+1)};
}
export function itemFromReference(reference:EquipmentReference):InventoryItem{
  return inventoryItemSchema.parse({id:crypto.randomUUID(),name:reference.name,quantity:1,weight:reference.weight,weightKnown:reference.weightKnown,equipped:false,notes:'',category:reference.category,location:'carried',equipSlot:reference.category==='armor'?'body':reference.category==='shield'?'off-hand':reference.category==='weapon'?(reference.weapon?.properties.toLowerCase().includes('two-handed')?'two-hands':'main-hand'):'worn',attuned:false,sourceId:reference.id,weapon:reference.weapon,armor:reference.armor});
}

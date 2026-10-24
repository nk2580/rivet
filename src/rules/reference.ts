import { useEffect,useState } from 'react';
import { z } from 'zod';
import type { RulesetId } from '@/domain/schema';
import { packSchema,referenceBlockSchema } from './spells';

const entrySchema=z.object({id:z.string(),title:z.string(),headings:z.array(z.string()),text:z.string(),page:z.number().int().positive().optional(),documentPath:z.string().regex(/^\/rules\/srd-3\.5\/[a-z0-9-]+\.json$/).optional(),document:z.string().optional(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional()});
export const referencePackSchema=packSchema.omit({spells:true}).extend({pdfPath:z.string().regex(/^\/rules\/SRD_CC_v[\d.]+\.pdf$/).optional(),pages:z.array(entrySchema)});
const documentSchema=z.object({id:z.string(),edition:z.literal('3.5e'),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),blocks:z.array(referenceBlockSchema)});
export type ReferencePack=z.infer<typeof referencePackSchema>;
export type ReferenceEntry=z.infer<typeof entrySchema>;
export type ReferenceDocument=z.infer<typeof documentSchema>;
const paths:Record<RulesetId,string>={'5e-2014':'srd-5.1-reference.json','5e-2024':'srd-5.2.1-reference.json','3.5e':'srd-3.5-reference.json'};
const pending=new Map<RulesetId,Promise<ReferencePack>>(),documents=new Map<string,Promise<ReferenceDocument>>();
export async function loadReferencePack(edition:RulesetId){
  let promise=pending.get(edition);
  if(!promise){promise=(async()=>{const response=await fetch(`/rules/${paths[edition]}`);if(!response.ok)throw new Error('The rules library could not load. Connect once to save it offline.');const pack=referencePackSchema.parse(await response.json());if(pack.edition!==edition||new Set(pack.pages.map(page=>page.id)).size!==pack.pages.length)throw new Error('The rules library failed its edition or identity check.');return pack;})();pending.set(edition,promise);promise.catch(()=>pending.delete(edition));}
  return promise;
}
export async function loadReferenceDocument(entry:ReferenceEntry){
  if(!entry.documentPath)throw new Error('This reference uses its original PDF.');
  let promise=documents.get(entry.documentPath);
  if(!promise){promise=(async()=>{const response=await fetch(entry.documentPath!);if(!response.ok)throw new Error('This source document is not available yet. Connect and try again.');const document=documentSchema.parse(await response.json());if(document.id!==entry.id||document.sourceSha256!==entry.sourceSha256)throw new Error('The source document failed its identity check. Update Rivet and try again.');return document;})();documents.set(entry.documentPath,promise);promise.catch(()=>documents.delete(entry.documentPath!));}
  return promise;
}
export function useReferencePack(edition:RulesetId){
  const [pack,setPack]=useState<ReferencePack|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let cancelled=false;setError('');void loadReferencePack(edition).then(value=>{if(!cancelled)setPack(value);}).catch(failure=>{if(!cancelled)setError(failure instanceof Error?failure.message:'Rules library unavailable.');});return()=>{cancelled=true;};},[edition,attempt]);
  return {pack:pack?.edition===edition?pack:null,error,retry:()=>setAttempt(value=>value+1)};
}
const normalized=(text:string)=>text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/-\n(?=[a-z])/g,'').replace(/\s+/g,' ').toLowerCase();
const indexes=new WeakMap<ReferencePack,{entry:ReferenceEntry;title:string;text:string}[]>();
export function searchReference(pack:ReferencePack,query:string){
  let index=indexes.get(pack);if(!index){index=pack.pages.map(entry=>({entry,title:normalized(entry.title+' '+entry.headings.join(' ')),text:normalized(entry.text)}));indexes.set(pack,index);}
  const terms=normalized(query.trim()).split(' ').filter(Boolean).slice(0,15);
  return index.filter(item=>terms.every(term=>item.title.includes(term)||item.text.includes(term))).map(item=>({entry:item.entry,rank:terms.reduce((score,term)=>score+(item.title.includes(term)?10:0),0)})).sort((a,b)=>b.rank-a.rank).map(item=>item.entry);
}
export function referenceExcerpt(entry:ReferenceEntry,query:string){
  const text=entry.text.replace(/-\n(?=[a-z])/g,'').replace(/\s+/g,' '),term=query.toLowerCase().trim().split(/\s+/).find(Boolean),index=term?text.toLowerCase().indexOf(term):0,start=Math.max(0,index-80);
  return (start?'…':'')+text.slice(start,start+320)+(text.length>start+320?'…':'');
}

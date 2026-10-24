import { z } from 'zod';
import { validateState } from '../../legacy/dist/model.js';
import { createCharacter } from '@/domain/character';
import { recordBase, recordSchema, type AppRecord, type Campaign, type Character, type Conversation, type Note, type Session } from '@/domain/schema';

const legacySchema = z.object({
  schemaVersion:z.literal(1), reviewed:z.boolean(), updatedAt:z.number(), activeSession:z.string(),
  character:z.object({name:z.string(),nickname:z.string(),species:z.string(),className:z.string(),subclass:z.string(),level:z.number(),background:z.string(),alignment:z.string(),rules:z.string(),ac:z.number(),hp:z.number(),maxHp:z.number(),tempHp:z.number(),speed:z.number(),initiativeBonus:z.number(),spellAbility:z.enum(['str','dex','con','int','wis','cha']),abilities:z.object({str:z.number(),dex:z.number(),con:z.number(),int:z.number(),wis:z.number(),cha:z.number()}),skills:z.record(z.string(),z.number()),saves:z.array(z.enum(['str','dex','con','int','wis','cha'])),conditions:z.array(z.string()),exhaustion:z.number(),inspiration:z.boolean(),concentration:z.string(),death:z.object({success:z.number(),failure:z.number()}),hitDie:z.union([z.literal(6),z.literal(8),z.literal(10),z.literal(12)]),hitDice:z.number(),maxHitDice:z.number(),slots:z.array(z.object({level:z.number(),max:z.number(),used:z.number()})),resources:z.array(z.object({id:z.string(),name:z.string(),max:z.number(),used:z.number(),reset:z.enum(['long','short','manual']),shortRecovery:z.number()})),gold:z.number(),equipment:z.string(),features:z.string(),backstory:z.string(),spells:z.array(z.object({id:z.string(),name:z.string(),level:z.number(),time:z.string(),range:z.string(),concentration:z.boolean(),prepared:z.boolean(),notes:z.string()}))}),
  sessions:z.array(z.object({id:z.string(),title:z.string(),date:z.string(),notes:z.array(z.object({id:z.string(),text:z.string(),tag:z.string(),include:z.boolean(),carry:z.boolean(),createdAt:z.number()}))})),
  log:z.array(z.object({id:z.string(),text:z.string(),at:z.number()})),
  questions:z.array(z.object({id:z.string(),text:z.string(),sessionId:z.string(),at:z.number()})),
});
export type ImportedSource = {id:string; format:'rivet-v1'; importedAt:string; original:unknown};
const sourceArchiveSchema=z.object({id:z.string().regex(/^legacy-[a-f0-9]{24}$/),format:z.literal('rivet-v1'),importedAt:z.string().datetime(),original:z.unknown()});
export function validateSourceArchive(input:unknown):ImportedSource {const source=sourceArchiveSchema.parse(input);validateState(source.original);return source;}
const slug = (value:string) => value.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').slice(0,90) || 'custom';

export async function migrateLegacy(input: unknown): Promise<{records:AppRecord[];source:ImportedSource}> {
  validateState(input); // Preserve the original prototype's complete import contract.
  const original=JSON.stringify(input);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(original));
  const fingerprint=Array.from(new Uint8Array(bytes)).map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,24);
  const prefix=`legacy-${fingerprint}`;
  const legacy=legacySchema.parse(input), c=legacy.character;
  const ruleset=c.rules.includes('2024')?'5e-2024':'5e-2014';
  const base=createCharacter(c.name,ruleset);
  if(base.ruleset==='3.5e') throw new Error('The original prototype does not support 3.5e imports.');
  const campaignId=`${prefix}-campaign`, characterId=`${prefix}-character`;
  const character:Character={...base,id:characterId,campaignId,species:c.species,background:c.background,alignment:c.alignment,backstory:c.backstory,abilities:c.abilities,classes:[{classId:slug(c.className),name:c.className,level:c.level,...(c.subclass?{subclassId:`custom-${slug(c.subclass)}`}:{})}],hp:c.hp,maxHp:c.maxHp,tempHp:c.tempHp,armorClass:c.ac,speed:c.speed,equipmentRules:false,armorTraining:[],initiativeAdjustment:c.initiativeBonus- Math.floor((c.abilities.dex-10)/2),spellAbility:c.spellAbility,concentration:c.concentration||null,conditions:c.conditions,resources:c.resources.map((r,i)=>({id:`resource-${i}`,name:r.name,maximum:r.max,spent:r.used,reset:r.reset,shortRecovery:r.shortRecovery})),slots:c.slots.map(s=>({level:s.level,maximum:s.max,spent:s.used})),spells:c.spells.map((s,i)=>({id:`spell-${i}`,name:s.name,level:s.level,castingTime:s.time,range:s.range,concentration:s.concentration,prepared:s.prepared,notes:s.notes})),gold:c.gold,features:c.features,skills:c.skills,saveProficiencies:c.saves,exhaustion:c.exhaustion,inspiration:c.inspiration,deathSaves:{successes:c.death.success,failures:c.death.failure},hitDice:[{classId:slug(c.className),size:c.hitDie,maximum:c.maxHitDice,spent:c.maxHitDice-c.hitDice}],reviewed:false,notes:[`Original rules: ${c.rules}`,c.nickname?`Nickname: ${c.nickname}`:'',c.equipment?`Imported equipment\n${c.equipment}`:'','Imported values are preserved for review; custom features have not been inferred from their names.'].filter(Boolean).join('\n\n')};
  const sessionIds=new Map(legacy.sessions.map((s,i)=>[s.id,`${prefix}-session-${i}`]));
  const campaign:Campaign={...recordBase('Imported adventure'),id:campaignId,kind:'campaign',description:'Imported from Rivet. Original character values and source backup are retained for review.',activeSessionId:sessionIds.get(legacy.activeSession)||null};
  const records:AppRecord[]=[character,campaign];
  for(const [i,s] of legacy.sessions.entries()) {
    const session:Session={...recordBase(s.title),id:sessionIds.get(s.id)!,kind:'session',campaignId,date:s.date,characterIds:[characterId],summary:''};records.push(session);
    for(const [j,n] of s.notes.entries()) {
      const tag=n.tag.toLowerCase();
      const noteType:Note['noteType']=tag==='npc'?'npc':tag==='quest'?'quest':tag==='ruling'?'ruling':tag==='loot'?'fact':'note';
      const note:Note={...recordBase(n.text.split('\n')[0].slice(0,100)||n.tag),id:`${prefix}-note-${i}-${j}`,kind:'note',noteType,campaignId,characterId,sessionId:session.id,body:n.text,tags:[n.tag],linkedIds:[],status:'open',shareWithGuide:n.include,carryForward:n.carry,createdAt:new Date(n.createdAt).toISOString()};records.push(note);
    }
  }
  if(legacy.log.length) records.push({...recordBase('Imported activity history'),id:`${prefix}-activity`,kind:'note',noteType:'note',campaignId,characterId,sessionId:null,body:legacy.log.map(entry=>`${new Date(entry.at).toISOString()} · ${entry.text}`).join('\n'),tags:['Legacy activity'],linkedIds:[],status:'archived',shareWithGuide:false,carryForward:false});
  if(legacy.questions.length){const conversation:Conversation={...recordBase('Imported questions'),id:`${prefix}-questions`,kind:'conversation',characterId,sessionId:null,messages:legacy.questions.map((q,i)=>({id:`question-${i}`,role:'user',text:q.text,at:new Date(q.at).toISOString()}))};records.push(conversation);}
  return {records:records.map(record=>recordSchema.parse(record)),source:{id:prefix,format:'rivet-v1',importedAt:new Date().toISOString(),original:input}};
}

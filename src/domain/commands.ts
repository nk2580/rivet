import { z } from 'zod';
import { characterSchema, characterSheetPatchSchema, currencyAmountsSchema,MAX_COINS, fifthStateSchema, fifthSheetFields, thirdSheetFields, resourceSchema, inventoryItemSchema, spellSchema,EQUIPMENT_SLOTS, now, type Character } from './schema';
import {applyRest,restCommandSchema} from './rest';
import {COINS,coinBalance,addCoins} from './currency';
const amount = z.number().int().min(1).max(99999);
export const characterCommandSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('damage'), amount}),
  z.object({type: z.literal('heal'), amount}),
  z.object({type: z.literal('temporary-hp'), amount}),
  z.object({type: z.literal('condition'), name: z.string().trim().min(1).max(150), active: z.boolean()}),
  z.object({type: z.literal('resource'), resourceId: z.string().min(1), change: z.number().int().min(-99).max(99).refine(n => n !== 0)}),
  z.object({type: z.literal('slot'), level: z.number().int().min(0).max(9), change: z.union([z.literal(-1), z.literal(1)])}),
  z.object({type: z.literal('concentration'), name: z.string().trim().min(1).max(200).nullable()}),
  z.object({type:z.literal('spell-cast'),spellId:z.string().min(1).max(120),slotLevel:z.number().int().min(0).max(9),exemptTargets:z.string().trim().max(500).optional(),duration:z.string().trim().max(200).optional()}),
  z.object({type:z.literal('inventory-add'),item:inventoryItemSchema}),
  z.object({type:z.literal('inventory-import'),items:z.array(inventoryItemSchema).min(1).max(100)}),
  z.object({type:z.literal('inventory-update'),item:inventoryItemSchema.extend({notes:inventoryItemSchema.shape.notes.optional()})}),
  z.object({type:z.literal('inventory-remove'),itemId:z.string().min(1)}),
  z.object({type:z.literal('inventory-equip'),itemId:z.string().min(1),equipped:z.boolean(),slot:z.enum(EQUIPMENT_SLOTS),replaceIds:z.array(z.string()).max(20).default([])}),
  z.object({type:z.literal('equipment-rules'),enabled:z.boolean(),armorTraining:z.array(z.enum(['light','medium','heavy','shield'])).max(4)}),
  z.object({type:z.literal('spell-add'),spell:spellSchema}),
  z.object({type:z.literal('spell-update'),spell:spellSchema.extend({notes:spellSchema.shape.notes.optional()})}),
  z.object({type:z.literal('spell-remove'),spellId:z.string().min(1)}),
  z.object({type:z.literal('spell-prepare'),spellId:z.string().min(1),prepared:z.boolean()}),
  z.object({type:z.literal('character-update'),changes:characterSheetPatchSchema}),
  z.object({type:z.literal('resource-add'),resource:resourceSchema}),
  z.object({type:z.literal('resource-update'),resource:z.object({...resourceSchema.shape,shortRecovery:z.number().int().min(0).max(999)}).partial().required({id:true}).strict().refine(r=>Object.keys(r).length>1,'Specify resource fields to change.')}),
  z.object({type:z.literal('resource-remove'),resourceId:z.string().min(1).max(120)}),
  z.object({type:z.literal('fifth-state'),changes:fifthStateSchema}),
  restCommandSchema,
  z.object({type:z.literal('currency'),operation:z.enum(['add','spend','set']),amounts:currencyAmountsSchema}).strict(),
]);
export type CharacterCommand = z.infer<typeof characterCommandSchema>;
export type CommandResult = {character: Character; summary: string; reminders: string[]};
export const routineCommandTypes=new Set(['damage','heal','temporary-hp','condition','resource','slot','concentration','spell-cast','spell-prepare','inventory-equip','fifth-state','rest','currency']);
export const routineCharacterCommandSchema=z.discriminatedUnion('type',[characterCommandSchema.options[0],...characterCommandSchema.options.slice(1).filter(option=>routineCommandTypes.has(option.shape.type.value))]);

const incapacitatingConditions=new Set(['incapacitated','unconscious','stunned','paralyzed','paralysed','petrified','dead']);
function endConcentration(c:Character){c.concentration=null;c.effects=c.effects.filter(effect=>!effect.concentration);}
function canConcentrate(c:Character){return c.hp>0&&(c.ruleset==='3.5e'||c.exhaustion<6)&&!c.conditions.some(condition=>incapacitatingConditions.has(condition.toLowerCase()));}

/** Compatibility with the failed cast command emitted before tool schemas were exposed. */
export function resolveCharacterCommand(input:unknown,c:Character):CharacterCommand{
  if(input&&typeof input==='object'&&'type' in input&&input.type==='cast_spell'){
    const legacy=z.object({type:z.literal('cast_spell'),spell:z.string().min(1),slotLevel:z.number().int().min(0).max(9),exemptTargets:z.string().max(500).optional(),duration:z.string().max(200).optional()}).parse(input);
    const matches=c.spells.filter(spell=>spell.id===legacy.spell||spell.name.normalize('NFKC').toLowerCase()===legacy.spell.normalize('NFKC').toLowerCase().trim());
    if(matches.length!==1)throw new Error(matches.length?'Choose the spell ID for the intended casting class.':'That spell is not on the selected character’s sheet.');
    return characterCommandSchema.parse({type:'spell-cast',spellId:matches[0].id,slotLevel:legacy.slotLevel,exemptTargets:legacy.exemptTargets,duration:legacy.duration});
  }
  return characterCommandSchema.parse(input);
}

/** Pure deterministic transitions. Rolls and table adjudication remain outside the app. */
export function applyCharacterCommand(original: Character, input: CharacterCommand): CommandResult {
  const command = characterCommandSchema.parse(input);
  const c = structuredClone(characterSchema.parse(original));
  const reminders: string[] = [];
  let summary = '';
  switch (command.type) {
    case 'currency':{
      const changes:string[]=[];
      for(const coin of COINS){
        const amount=command.amounts[coin.key];
        if(amount===undefined)continue;
        const previous=coinBalance(c,coin.key);
        const next=command.operation==='set'?amount:addCoins(previous,command.operation==='spend'?-amount:amount);
        if(next<0)throw new Error(`Not enough ${coin.name.toLowerCase()} pieces. You hold ${previous} ${coin.abbreviation}.`);
        if(next>MAX_COINS)throw new Error(`${coin.name} cannot exceed ${MAX_COINS} pieces.`);
        c[coin.key]=next;
        changes.push(`${coin.abbreviation} ${previous} → ${next}`);
      }
      summary=`Currency: ${changes.join(', ')}`;break;
    }
    case 'character-update': {
      const fields=Object.keys(command.changes);
      if(fields.some(field=>(c.ruleset==='3.5e'?fifthSheetFields:thirdSheetFields).includes(field)))throw new Error('These sheet fields belong to a different rules edition.');
      const patch={...command.changes};
      for(const field of ['abilities','skills','skillRanks','saves','deathSaves'] as const){
        if(field in patch)(patch as any)[field]={...(c as any)[field],...(patch as any)[field]};
      }
      Object.assign(c,patch);
      if(c.ruleset!=='3.5e'){
        if(patch.classes||patch.hitDice){
          for(const pool of c.hitDice)if(pool.maximum>(c.classes.find(cl=>cl.classId===pool.classId)?.level??0))throw new Error('Update hit-die pools to fit the recorded classes and levels in the same character-update.');
        }
        if(!canConcentrate(c))endConcentration(c);
        const concentrating=c.effects.filter(effect=>effect.concentration);
        if(concentrating.length>1||concentrating.some(effect=>effect.name!==c.concentration))throw new Error('Concentration effects must match the current concentration. Use the concentration or spell-cast command to change it.');
      }
      summary=`Updated character: ${fields.join(', ')}`;
      reminders.push('Recorded the requested values. Class progression, prerequisites and dependent statistics are not automatically recalculated.');
      break;
    }
    case 'resource-add':
      if(c.resources.some(r=>r.id===command.resource.id))throw new Error('This resource is already on the sheet.');
      c.resources.push(command.resource);summary=`Added ${command.resource.name}: ${command.resource.maximum-command.resource.spent} / ${command.resource.maximum} uses; ${command.resource.reset} recovery`;break;
    case 'resource-update':{
      const index=c.resources.findIndex(r=>r.id===command.resource.id);
      if(index<0)throw new Error('That resource is no longer on the sheet.');
      const resource=resourceSchema.parse({...c.resources[index],...command.resource});c.resources[index]=resource;
      summary=`Updated ${resource.name}: ${resource.maximum-resource.spent} / ${resource.maximum} uses; ${resource.reset} recovery`;break;
    }
    case 'resource-remove':{
      const resource=c.resources.find(r=>r.id===command.resourceId);if(!resource)throw new Error('That resource is no longer on the sheet.');
      c.resources=c.resources.filter(r=>r.id!==command.resourceId);summary=`Removed ${resource.name}`;break;
    }
    case 'fifth-state':
      if(c.ruleset==='3.5e')throw new Error('Death saves, inspiration and exhaustion counters use fifth-edition rules.');
      if(command.changes.exhaustion!==undefined)c.exhaustion=command.changes.exhaustion;
      if(command.changes.inspiration!==undefined)c.inspiration=command.changes.inspiration;
      if(command.changes.deathSaves)c.deathSaves={...c.deathSaves,...command.changes.deathSaves};
      if(c.exhaustion===6)endConcentration(c);
      summary=`Updated ${Object.keys(command.changes).join(', ')}`;break;
    case 'rest':{
      const result=applyRest(c,command);summary=result.summary;reminders.push(...result.reminders);break;
    }
    case 'damage': {
      const absorbed = Math.min(c.tempHp, command.amount);
      c.tempHp -= absorbed;
      c.hp = c.ruleset === '3.5e' ? Math.max(-10000, c.hp - (command.amount - absorbed)) : Math.max(0, c.hp - (command.amount - absorbed));
      if (c.ruleset !== '3.5e' && c.concentration) {
        const raw = Math.max(10, Math.floor(command.amount / 2));
        const dc = c.ruleset === '5e-2024' ? Math.min(30, raw) : raw;
        if (c.hp > 0) reminders.push(`Concentration requires a Constitution saving throw, DC ${dc}. Resolve it at the table.`);
        else endConcentration(c);
      }
      if (c.ruleset === '3.5e' && c.hp <= 0) { c.stable = false; reminders.push(c.hp <= -10 ? 'At −10 HP or lower, review death and applicable exceptions with your DM.' : 'Review disabled, dying, and stabilization rules with your DM.'); }
      else if (c.hp === 0) reminders.push('Review unconsciousness, death saves, and massive damage with your DM.');
      summary = `${command.amount} damage${absorbed ? `, ${absorbed} absorbed by temporary HP` : ''}`;
      break;
    }
    case 'heal': {
      const previous = c.hp;
      c.hp = Math.min(c.maxHp, c.hp + command.amount);
      if (c.ruleset !== '3.5e' && c.hp > 0) c.deathSaves = {successes: 0, failures: 0};
      summary = `Recovered ${c.hp - previous} HP`; break;
    }
    case 'temporary-hp': c.tempHp = Math.max(c.tempHp, command.amount); summary = `Temporary HP: ${c.tempHp}`; break;
    case 'condition': {
      const matches=(name:string)=>name.toLowerCase()===command.name.toLowerCase();
      if(command.active){if(!c.conditions.some(matches))c.conditions.push(command.name);}
      else c.conditions=c.conditions.filter(condition=>!matches(condition));
      if(c.ruleset!=='3.5e'&&command.active&&incapacitatingConditions.has(command.name.toLowerCase()))endConcentration(c);
      summary=`${command.active?'Added':'Removed'} ${command.name}`;break;
    }
    case 'resource': {
      const resource = c.resources.find(r => r.id === command.resourceId);
      if (!resource) throw new Error('This character does not have that resource.');
      const spent = resource.spent + command.change;
      if (spent < 0 || spent > resource.maximum) throw new Error('That change exceeds the available resource.');
      resource.spent = spent; summary = `${resource.name}: ${resource.maximum - resource.spent} available`; break;
    }
    case 'slot': {
      const slot = c.slots.find(s => s.level === command.level);
      if (!slot || slot.spent + command.change < 0 || slot.spent + command.change > slot.maximum) throw new Error('That change exceeds the available spell slots.');
      slot.spent += command.change; summary = `Level ${slot.level}: ${slot.maximum - slot.spent} slots available`; break;
    }
    case 'concentration': {
      if(c.ruleset==='3.5e')throw new Error('Use the 3.5e spell effect and concentration rules.');
      if(command.name&&!canConcentrate(c))throw new Error('This character cannot start concentration while incapacitated or at 0 HP.');
      if(!command.name||command.name!==c.concentration)endConcentration(c);
      c.concentration=command.name;summary=command.name?`Concentrating on ${command.name}`:'Ended concentration';break;
    }
    case 'spell-cast': {
      if(c.ruleset==='3.5e')throw new Error('3.5e casting requires class-specific preparation and slot rules. Record its resources separately; fifth-edition concentration was not applied.');
      const spell=c.spells.find(spell=>spell.id===command.spellId);
      if(!spell)throw new Error('That spell is not on the selected character’s sheet.');
      if(!spell.prepared)throw new Error('Prepare this spell before recording its cast.');
      if(!canConcentrate(c))throw new Error('This character cannot cast while incapacitated or at 0 HP.');
      if(spell.level===0&&command.slotLevel!==0)throw new Error('Cantrips do not use spell slots. Choose slot level 0.');
      if(spell.level>0){
        if(command.slotLevel<spell.level)throw new Error(`This spell needs a level ${spell.level} or higher slot.`);
        const slot=c.slots.find(slot=>slot.level===command.slotLevel);
        if(!slot||slot.spent>=slot.maximum)throw new Error('No spell slot of that level is available.');
        slot.spent++;
      }
      if(spell.concentration){
        endConcentration(c);
        if(c.effects.some(effect=>effect.id===spell.id))throw new Error('A different effect already uses this spell’s ID. Review that effect before casting.');
        c.concentration=spell.name;
        c.effects.push({id:spell.id,name:spell.name,source:spell.sourceId??c.rulesVersion,duration:command.duration||'While concentrating',notes:'',modifiers:[],concentration:true,spellId:spell.id,slotLevel:command.slotLevel,...(command.exemptTargets?{exemptTargets:command.exemptTargets}:{})});
      }
      summary=`Cast ${spell.name}${spell.level?` using a level ${command.slotLevel} slot`:' (cantrip)'}${spell.concentration?'; concentrating':''}${command.exemptTargets?`; unaffected: ${command.exemptTargets}`:''}`;
      break;
    }
    case 'equipment-rules':c.equipmentRules=command.enabled;c.armorTraining=[...new Set(command.armorTraining)];summary=command.enabled?'Using equipped gear for armour class and movement':'Using reviewed armour class and base movement';break;
    case 'spell-add':{
      const normalized=(name:string)=>name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'');
      if(c.spells.some(spell=>spell.id===command.spell.id||(normalized(spell.name)===normalized(command.spell.name)&&(!spell.castingClass||!command.spell.castingClass||spell.castingClass===command.spell.castingClass))))throw new Error('This spell is already on the sheet for that casting class.');
      c.spells.push(command.spell);summary=`Added ${command.spell.name} to the spellbook`;break;
    }
    case 'spell-update':{
      const index=c.spells.findIndex(spell=>spell.id===command.spell.id);if(index<0)throw new Error('That spell is no longer on this sheet.');
      c.spells[index]={...command.spell,notes:command.spell.notes??c.spells[index].notes};summary=`Updated ${command.spell.name}`;break;
    }
    case 'spell-remove':{
      const spell=c.spells.find(spell=>spell.id===command.spellId);if(!spell)throw new Error('That spell is no longer on this sheet.');
      c.spells=c.spells.filter(entry=>entry.id!==spell.id);summary=`Removed ${spell.name} from the spellbook`;break;
    }
    case 'spell-prepare':{
      const spell=c.spells.find(spell=>spell.id===command.spellId);if(!spell)throw new Error('That spell is no longer on this sheet.');
      spell.prepared=command.prepared;summary=`${command.prepared?'Prepared':'Unprepared'} ${spell.name}`;break;
    }
    case 'inventory-add':
      if(c.inventory.some(item=>item.id===command.item.id))throw new Error('This item is already in the inventory.');
      c.inventory.push(command.item);summary=`Added ${command.item.name} to inventory`;break;
    case 'inventory-import':
      if(command.items.some(item=>c.inventory.some(existing=>existing.id===item.id)))throw new Error('An imported item is already in this inventory.');
      c.inventory.push(...command.items);summary=`Imported ${command.items.length} carried items for review`;break;
    case 'inventory-update':{
      const index=c.inventory.findIndex(item=>item.id===command.item.id);if(index<0)throw new Error('That item is no longer in this inventory.');
      c.inventory[index]={...command.item,notes:command.item.notes??c.inventory[index].notes};summary=`Updated ${command.item.name}`;break;
    }
    case 'inventory-remove':{
      const item=c.inventory.find(item=>item.id===command.itemId);if(!item)throw new Error('That item is no longer in this inventory.');
      c.inventory=c.inventory.filter(entry=>entry.id!==item.id);summary=`Removed ${item.name} from inventory`;break;
    }
    case 'inventory-equip':{
      const item=c.inventory.find(entry=>entry.id===command.itemId);if(!item)throw new Error('That item is no longer in this inventory.');
      if(command.equipped&&item.quantity===0)throw new Error('You cannot equip an item with zero quantity.');
      const blocking=c.inventory.filter(other=>other.equipped&&other.id!==item.id&&(['body','main-hand','off-hand','two-hands'].includes(command.slot))&&(other.equipSlot===command.slot||(command.slot==='two-hands'&&['main-hand','off-hand'].includes(other.equipSlot))||(['main-hand','off-hand'].includes(command.slot)&&other.equipSlot==='two-hands')));
      if(command.equipped&&blocking.some(other=>!command.replaceIds.includes(other.id)))throw new Error(`Stow ${blocking.map(other=>other.name).join(', ')} before using that slot.`);
      for(const other of blocking)if(command.equipped)other.equipped=false;
      item.equipped=command.equipped;item.equipSlot=command.slot;
      summary=`${command.equipped?'Equipped':'Stowed'} ${item.name}${command.equipped&&blocking.length?`; stowed ${blocking.map(other=>other.name).join(', ')}`:''}`;break;
    }
  }
  c.updatedAt = now();
  return {character: characterSchema.parse(c), summary, reminders};
}

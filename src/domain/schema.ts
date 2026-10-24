import { z } from 'zod';
import {portraitSchema} from './portrait';

export const OWNER_EMAIL = 'owner@example.test';
export const RULESETS = ['5e-2014', '5e-2024', '3.5e'] as const;
export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export const abilityNames = {str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma'};
export const rulesetNames = {'5e-2014': '5e · 2014', '5e-2024': '5e · 2024', '3.5e': '3.5e'};
export type RulesetId = typeof RULESETS[number];
export type Ability = typeof ABILITIES[number];
const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const text = (max = 200) => z.string().max(max);
const integer = (min: number, max: number) => z.number().int().min(min).max(max);
const abilities = z.object({str: integer(1, 100), dex: integer(1, 100), con: integer(1, 100), int: integer(1, 100), wis: integer(1, 100), cha: integer(1, 100)});
const base = {schemaVersion: z.literal(2), id, name: text().min(1), createdAt: z.string().datetime(), updatedAt: z.string().datetime()};
const classLevel = z.object({classId: text(80).min(1), name: text(100).min(1), level: integer(1, 20), subclassId: text(120).optional()});
export const resourceSchema = z.object({id, name: text().min(1), description:text(10000).optional(), source:text(500).optional(), maximum: integer(0, 999), spent: integer(0, 999), reset: z.enum(['short', 'long', 'daily', 'manual']), shortRecovery: integer(0, 999).default(0)}).refine(r => r.spent <= r.maximum, 'A resource cannot be overspent.');
const slot = z.object({level: integer(0, 9), maximum: integer(0, 99), spent: integer(0, 99), reset:z.enum(['short','long','manual']).optional()}).refine(s => s.spent <= s.maximum, 'Spell slots cannot be overspent.');
export const spellSchema = z.object({id, name: text().min(1), level: integer(0, 9), castingTime: text(), range: text(), concentration: z.boolean(), prepared: z.boolean(), notes: text(20000), sourceId: text().optional(),castingClass:text(80).optional()});
export type CharacterSpell=z.infer<typeof spellSchema>;
const effect = z.object({id, name: text(), source: text(), duration: text(), notes: text(10000), concentration:z.boolean().optional(),spellId:id.optional(),slotLevel:integer(0,9).optional(),exemptTargets:text(500).optional(), modifiers: z.array(z.object({target: text(), value: z.number().finite(), type: text(), source: text()})).max(50)});
const override = z.object({id, target: text(), value: z.number().finite(), reason: text(2000).min(1), source: text()});
export const EQUIPMENT_CATEGORIES=['weapon','armor','shield','ammunition','tool','gear','treasure'] as const;
export const EQUIPMENT_SLOTS=['carried','main-hand','off-hand','two-hands','body','worn'] as const;
export const weaponDataSchema=z.object({damage:text(),smallDamage:text().optional(),damageType:text(),critical:text().optional(),properties:text(2000),range:text(),ability:z.enum(['str','dex','finesse']),proficient:z.boolean().default(false),bonus:integer(-20,20)});
export const armorDataSchema=z.object({baseAC:integer(0,99),dexCap:integer(0,20).nullable(),strengthRequirement:integer(0,100),stealthDisadvantage:z.boolean(),checkPenalty:integer(-20,0).default(0),arcaneFailure:integer(0,100).default(0),speed30:integer(0,30).nullable().default(null),speed20:integer(0,20).nullable().default(null)});
export const inventoryItemSchema = z.object({id,name:text().min(1),quantity:integer(0,99999),weight:z.number().finite().min(0).max(99999),equipped:z.boolean(),notes:text(10000),location:z.enum(['carried','stored']).default('carried'),weightKnown:z.boolean().default(true),category:z.enum(EQUIPMENT_CATEGORIES).default('gear'),equipSlot:z.enum(EQUIPMENT_SLOTS).default('carried'),attuned:z.boolean().default(false),sourceId:text().optional(),weapon:weaponDataSchema.optional(),armor:armorDataSchema.optional()});
export type InventoryItem=z.infer<typeof inventoryItemSchema>;
export const MAX_COINS=999999999;
// Gold keeps its existing fractional values for compatibility with older sheets.
export const coinAmountsSchema=z.object({copper:integer(0,MAX_COINS),silver:integer(0,MAX_COINS),electrum:integer(0,MAX_COINS),gold:z.number().finite().min(0).max(MAX_COINS),platinum:integer(0,MAX_COINS)});
export const currencyAmountsSchema=coinAmountsSchema.partial().strict().refine(coins=>Object.keys(coins).length>0,'Specify at least one coin balance.');
const characterBase = {
  ...base, kind: z.literal('character'), rulesVersion: text(100), campaignId: id.nullable(),
  portrait: portraitSchema.nullable().optional(),
  species: text(), background: text(), alignment: text(), backstory: text(30000),
  abilities, classes: z.array(classLevel).min(1).max(20),
  hp: integer(-10000, 99999), maxHp: integer(1, 99999), tempHp: integer(0, 99999),
  armorClass: integer(0, 999), speed: integer(0, 999), initiativeAdjustment: integer(-99, 99),
  equipmentRules:z.boolean().default(false),armorTraining:z.array(z.enum(['light','medium','heavy','shield'])).max(4).default([]),
  spellAbility: z.enum(ABILITIES), concentration: text().nullable(),
  conditions: z.array(text()).max(50), resources: z.array(resourceSchema).max(100), slots: z.array(slot).max(100),
  spells: z.array(spellSchema).max(2000), inventory: z.array(inventoryItemSchema).max(1000),
  effects: z.array(effect).max(100), overrides: z.array(override).max(100),
  feats: z.array(text()).max(200), features: text(30000), gold:coinAmountsSchema.shape.gold,
  copper:coinAmountsSchema.shape.copper.optional(),silver:coinAmountsSchema.shape.silver.optional(),electrum:coinAmountsSchema.shape.electrum.optional(),platinum:coinAmountsSchema.shape.platinum.optional(),
  reviewed: z.boolean(), notes: text(30000),
};
const fifth = {
  skills: z.record(z.string(), integer(0, 2)), saveProficiencies: z.array(z.enum(ABILITIES)).max(6),
  exhaustion: integer(0, 6), inspiration: z.boolean(),
  deathSaves: z.object({successes: integer(0, 3), failures: integer(0, 3)}),
  hitDice: z.array(z.object({classId: text(), size: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]), maximum: integer(0, 20), spent: integer(0, 20)})).max(20),
};

// Partial sheet edits never accept document identity, edition, timestamps or portrait bytes.
// Nested scores and skill maps merge; lists replace only the explicitly named field.
const {schemaVersion:_schema,id:_id,kind:_kind,createdAt:_created,updatedAt:_updated,rulesVersion:_version,portrait:_portrait,concentration:_concentration,inventory:_inventory,spells:_spells,...editableBase}=characterBase;
const third = {skillRanks: z.record(z.string(), z.number().min(0).max(23)), baseAttackBonus: integer(0, 20), saves: z.object({fortitude: integer(-50, 99), reflex: integer(-50, 99), will: integer(-50, 99)}), touchArmorClass: integer(0, 999), flatFootedArmorClass: integer(0, 999), nonlethalDamage: integer(0, 99999), stable: z.boolean()};
export const fifthStateSchema=z.object({exhaustion:fifth.exhaustion,inspiration:fifth.inspiration,deathSaves:fifth.deathSaves.partial().strict()}).partial().strict().refine(p=>Object.keys(p).length>0,'Specify at least one state change.');
export const characterSheetPatchSchema=z.object({...editableBase,...fifth,...third,equipmentRules:z.boolean(),armorTraining:characterBase.armorTraining.removeDefault(),abilities:abilities.partial().strict(),saves:third.saves.partial().strict(),deathSaves:fifth.deathSaves.partial().strict()}).partial().strict().refine(p=>Object.keys(p).length>0,'Specify at least one sheet field.');
export const fifthSheetFields=Object.keys(fifth);
export const thirdSheetFields=Object.keys(third);
export const characterSchema = z.discriminatedUnion('ruleset', [
  z.object({...characterBase, ...fifth, ruleset: z.literal('5e-2014')}),
  z.object({...characterBase, ...fifth, ruleset: z.literal('5e-2024')}),
  z.object({...characterBase, ruleset: z.literal('3.5e'), ...third}),
]).superRefine((c, ctx) => {
  if (c.classes.reduce((n, cl) => n + cl.level, 0) > 20) ctx.addIssue({code: 'custom', message: 'Core characters cannot exceed level 20.', path: ['classes']});
  if (c.hp > c.maxHp || (c.ruleset !== '3.5e' && c.hp < 0)) ctx.addIssue({code: 'custom', message: 'Hit points are outside this edition’s limits.', path: ['hp']});
  if (new Set(c.resources.map(r => r.id)).size !== c.resources.length) ctx.addIssue({code: 'custom', message: 'Duplicate resource IDs.', path: ['resources']});
  if (new Set(c.slots.map(s=>s.level)).size!==c.slots.length)ctx.addIssue({code:'custom',message:'Duplicate spell slot levels.',path:['slots']});
  if (new Set(c.effects.map(e=>e.id)).size!==c.effects.length)ctx.addIssue({code:'custom',message:'Duplicate effect IDs.',path:['effects']});
  if (new Set(c.overrides.map(o=>o.target)).size!==c.overrides.length)ctx.addIssue({code:'custom',message:'Duplicate calculation overrides.',path:['overrides']});
  if (new Set(c.classes.map(cl=>cl.classId)).size!==c.classes.length)ctx.addIssue({code:'custom',message:'Duplicate class IDs.',path:['classes']});
  if(c.ruleset!=='3.5e'){
    if(new Set(c.hitDice.map(h=>h.classId)).size!==c.hitDice.length)ctx.addIssue({code:'custom',message:'Duplicate hit-die pools.',path:['hitDice']});
    for(const pool of c.hitDice)if(pool.spent>pool.maximum)ctx.addIssue({code:'custom',message:'Hit dice cannot be overspent.',path:['hitDice']});
  }
  if(new Set(c.spells.map(spell=>spell.id)).size!==c.spells.length)ctx.addIssue({code:'custom',message:'Duplicate spell IDs.',path:['spells']});
  if(new Set(c.inventory.map(item=>item.id)).size!==c.inventory.length)ctx.addIssue({code:'custom',message:'Duplicate equipment IDs.',path:['inventory']});
  if(c.ruleset!=='3.5e'&&c.inventory.filter(item=>item.attuned).length>3)ctx.addIssue({code:'custom',message:'Only three items can be attuned at once unless your DM grants an exception.',path:['inventory']});
  const occupied=new Set<string>();
  for(const item of c.inventory.filter(item=>item.equipped)){
    if(item.quantity===0||item.location==='stored')ctx.addIssue({code:'custom',message:'Equipped items must have a positive quantity and be carried.',path:['inventory']});
    const slots=item.equipSlot==='two-hands'?['main-hand','off-hand']:['main-hand','off-hand','body'].includes(item.equipSlot)?[item.equipSlot]:[];
    for(const slot of slots){if(occupied.has(slot))ctx.addIssue({code:'custom',message:`More than one equipped item occupies ${slot}.`,path:['inventory']});occupied.add(slot);}
  }
});
export type Character = z.infer<typeof characterSchema>;
export type FifthCharacter = Extract<Character, {ruleset: '5e-2014' | '5e-2024'}>;
export const campaignSchema = z.object({...base, kind: z.literal('campaign'), description: text(30000), activeSessionId: id.nullable()});
export const sessionSchema = z.object({...base, kind: z.literal('session'), campaignId: id, date: text(40), characterIds: z.array(id).max(100), summary: text(30000)});
export const NOTE_KINDS = ['note', 'party', 'npc', 'quest', 'goal', 'place', 'fact', 'ruling'] as const;
export const noteSchema = z.object({...base, kind: z.literal('note'), noteType: z.enum(NOTE_KINDS), campaignId: id.nullable(), characterId: id.nullable(), sessionId: id.nullable(), body: text(50000), tags: z.array(text(60)).max(30), linkedIds: z.array(id).max(100), status: z.enum(['open', 'active', 'complete', 'archived']), shareWithGuide: z.boolean(), carryForward: z.boolean()});
export const conversationSchema = z.object({...base, kind: z.literal('conversation'), characterId: id, sessionId: id.nullable(), messages: z.array(z.object({id, role: z.enum(['user', 'assistant']), text: text(50000), at: z.string().datetime()})).max(300)});
export const recordSchema = z.discriminatedUnion('kind', [characterSchema, campaignSchema, sessionSchema, noteSchema, conversationSchema]);
export type AppRecord = z.infer<typeof recordSchema>;
export type RecordKind = AppRecord['kind'];
export type Campaign = z.infer<typeof campaignSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
export function recordBase(name: string) { const at = now(); return {schemaVersion: 2 as const, id: newId(), name, createdAt: at, updatedAt: at}; }

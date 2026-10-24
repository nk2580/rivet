import { characterSchema, recordBase, type Character, type RulesetId } from './schema';
import { equipmentArmor,equipmentMovement,weaponAttack } from './equipment';

export function createCharacter(name: string, ruleset: RulesetId): Character {
  const base = {
    ...recordBase(name.trim()), kind: 'character' as const, ruleset,
    rulesVersion: ruleset === '5e-2024' ? 'SRD-5.2.1' : ruleset === '5e-2014' ? 'SRD-5.1' : 'SRD-3.5',
    campaignId: null, species: '', background: '', alignment: '', backstory: '',
    abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
    classes: [{classId: 'fighter', name: 'Fighter', level: 1}], hp: 10, maxHp: 10, tempHp: 0,
    armorClass: 10, speed: 30, initiativeAdjustment: 0, equipmentRules:true,armorTraining:['light','medium','heavy','shield'],spellAbility: 'int', concentration: null,
    conditions: [], resources: [], slots: [], spells: [], inventory: [], effects: [], overrides: [],
    feats: [], features: '', copper:0,silver:0,electrum:0,gold:0,platinum:0, reviewed: false, notes: '',
  };
  if (ruleset === '3.5e') return characterSchema.parse({...base, skillRanks: {}, baseAttackBonus: 1, saves: {fortitude: 2, reflex: 0, will: 0}, touchArmorClass: 10, flatFootedArmorClass: 10, nonlethalDamage: 0, stable: false});
  return characterSchema.parse({...base, skills: {}, saveProficiencies: ['str', 'con'], exhaustion: 0, inspiration: false, deathSaves: {successes: 0, failures: 0}, hitDice: [{classId: 'fighter', size: 10, maximum: 1, spent: 0}]});
}

export const levelOf = (character: Character) => character.classes.reduce((level, cl) => level + cl.level, 0);
export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
export const proficiencyBonus = (level: number) => 2 + Math.floor((level - 1) / 4);
export const classSummary = (character: Character) => character.classes.map(cl => `${cl.name} ${cl.level}`).join(' / ');

export type Calculation = {label: string; total: number; terms: {label: string; value: number; source: string}[]};
export function calculate(character: Character, target: string): Calculation {
  const terms: Calculation['terms'] = [];
  const add = (label: string, value: number, source: string) => terms.push({label, value, source});
  if (target === 'initiative') { add('Dexterity', abilityModifier(character.abilities.dex), character.rulesVersion); add('Adjustment', character.initiativeAdjustment, 'Character setting'); }
  else if (target === 'proficiency') { if (character.ruleset === '3.5e') throw new Error('3.5e has no fifth-edition proficiency bonus.'); add('Character level', proficiencyBonus(levelOf(character)), character.rulesVersion); }
  else if (target === 'spellAttack' || target === 'spellDC') {
    if (character.ruleset === '3.5e') throw new Error('3.5e spell DCs require the spell level; use the 3.5e casting calculation.');
    if (target === 'spellDC') add('Base', 8, character.rulesVersion);
    add('Proficiency', proficiencyBonus(levelOf(character)), character.rulesVersion);
    add(character.spellAbility.toUpperCase(), abilityModifier(character.abilities[character.spellAbility]), character.rulesVersion);
  } else if (['armorClass','touchArmorClass','flatFootedArmorClass'].includes(target)) {
    if(character.equipmentRules)terms.push(...equipmentArmor(character,target));
    else add('Reviewed armour class',target==='touchArmorClass'&&character.ruleset==='3.5e'?character.touchArmorClass:target==='flatFootedArmorClass'&&character.ruleset==='3.5e'?character.flatFootedArmorClass:character.armorClass,'Character armour setting');
  }
  else if(target.startsWith('weapon-attack:'))terms.push(...weaponAttack(character,target.slice('weapon-attack:'.length)));
  else if (target === 'speed') {add('Base movement', character.speed, 'Character movement setting');if(character.equipmentRules)terms.push(...equipmentMovement(character));}
  else throw new Error(`Unknown calculation: ${target}`);
  const override = character.overrides.find(o => o.target === target);
  if (override) return {label: target, total: override.value, terms: [{label: override.reason, value: override.value, source: override.source || 'DM override'}]};
  for (const effect of character.effects) for (const modifier of effect.modifiers) if (modifier.target === target) add(`${effect.name}: ${modifier.type}`, modifier.value, modifier.source || effect.source);
  return {label: target, total: terms.reduce((total, term) => total + term.value, 0), terms};
}

import {describe, expect, it} from 'vitest';
import {createCharacter} from '../src/domain/character';
import {applyCharacterCommand,resolveCharacterCommand} from '../src/domain/commands';

import {castingCharacter} from './fixtures/casting';

describe('atomic fifth-edition spell casting', () => {
  it('records Spirit Guardians, the chosen slot and party exemption in one immutable change', () => {
    const c = castingCharacter();
    const result = applyCharacterCommand(c, {type: 'spell-cast', spellId: 'guardians', slotLevel: 3, exemptTargets: 'party', duration: 'Up to 10 minutes'});
    expect(result.character).toMatchObject({concentration: 'Spirit Guardians', slots: [{spent: 0}, {spent: 1}, {spent: 0}]});
    expect(result.character.effects).toContainEqual(expect.objectContaining({name: 'Spirit Guardians', concentration: true, exemptTargets: 'party', slotLevel: 3}));
    expect(c.concentration).toBeNull(); expect(c.slots[1].spent).toBe(0);
  });
  it('upcasts in either fifth edition, replaces concentration, and leaves it intact for a non-concentration spell',()=>{
    for(const edition of ['5e-2014','5e-2024'] as const){
      let c=applyCharacterCommand(castingCharacter(edition),{type:'spell-cast',spellId:'guardians',slotLevel:4}).character;
      c.effects.push({id:'manual',name:'Table effect',source:'DM',duration:'Until ended',notes:'',modifiers:[]});
      c=applyCharacterCommand(c,{type:'spell-cast',spellId:'bolt',slotLevel:1}).character;
      expect(c.concentration).toBe('Spirit Guardians');
      c=applyCharacterCommand(c,{type:'spell-cast',spellId:'bless',slotLevel:1}).character;
      expect(c.concentration).toBe('Bless');expect(c.effects.map(effect=>effect.name)).toEqual(['Table effect','Bless']);
      const slots=structuredClone(c.slots);
      c=applyCharacterCommand(c,{type:'spell-cast',spellId:'guidance',slotLevel:0}).character;
      expect(c.concentration).toBe('Guidance');expect(c.slots).toEqual(slots);
      c=applyCharacterCommand(c,{type:'concentration',name:null}).character;
      expect(c.effects.map(effect=>effect.name)).toEqual(['Table effect']);expect(c.slots).toEqual(slots);
    }
  });
  it('rejects unavailable, lower-level, unprepared and incapacitated casts without partially changing the sheet',()=>{
    const c=castingCharacter();c.concentration='Bless';c.slots[1].spent=2;
    const before=structuredClone(c);
    for(const command of [{type:'spell-cast' as const,spellId:'guardians',slotLevel:3},{type:'spell-cast' as const,spellId:'guardians',slotLevel:1},{type:'spell-cast' as const,spellId:'missing',slotLevel:3},{type:'spell-cast' as const,spellId:'guidance',slotLevel:1}])expect(()=>applyCharacterCommand(c,command)).toThrow();
    expect(c).toEqual(before);
    c.spells[0].prepared=false;expect(()=>applyCharacterCommand(c,{type:'spell-cast',spellId:'guardians',slotLevel:4})).toThrow('Prepare');
    c.conditions=['Incapacitated'];expect(()=>applyCharacterCommand(c,{type:'spell-cast',spellId:'bless',slotLevel:1})).toThrow('incapacitated');
    expect(()=>applyCharacterCommand(c,{type:'concentration',name:'Bless'})).toThrow('incapacitated');
  });
  it('clears concentration effects on incapacitation or 0 HP and retains saving throw reminders otherwise',()=>{
    const c=applyCharacterCommand(castingCharacter(),{type:'spell-cast',spellId:'guardians',slotLevel:3}).character;
    const damaged=applyCharacterCommand(c,{type:'damage',amount:2});expect(damaged.character.concentration).toBe('Spirit Guardians');expect(damaged.reminders[0]).toContain('DC 10');
    for(const name of ['Incapacitated','Unconscious','Paralyzed','Stunned','Petrified']){
      const stopped=applyCharacterCommand(c,{type:'condition',name,active:true}).character;expect(stopped.concentration).toBeNull();expect(stopped.effects).toEqual([]);expect(stopped.slots[1].spent).toBe(1);
    }
    const stopped=applyCharacterCommand(c,{type:'damage',amount:48}).character;expect(stopped.concentration).toBeNull();expect(stopped.effects).toEqual([]);
  });
  it('resolves the reported legacy command by sheet spell identity and keeps 3.5e separate',()=>{
    const c=castingCharacter();expect(resolveCharacterCommand({type:'cast_spell',spell:'Spirit Guardians',slotLevel:3,exemptTargets:'party'},c)).toEqual({type:'spell-cast',spellId:'guardians',slotLevel:3,exemptTargets:'party'});
    expect(()=>applyCharacterCommand(createCharacter('3.5e caster','3.5e'),{type:'spell-cast',spellId:'guardians',slotLevel:3})).toThrow('3.5e');
  });
});

import {describe,expect,it} from 'vitest';
import {createCharacter} from '../src/domain/character';
import {applyCharacterCommand,characterCommandSchema} from '../src/domain/commands';
import {COINS,coinBalance} from '../src/domain/currency';
import {characterSchema,characterSheetPatchSchema,MAX_COINS,RULESETS,type Character} from '../src/domain/schema';
import {defaultState} from '../legacy/dist/model.js';
import {migrateLegacy} from '../src/storage/import';

const balances=(c:Character)=>Object.fromEntries(COINS.map(coin=>[coin.key,coinBalance(c,coin.key)]));
describe('coin balances',()=>{
  for(const edition of RULESETS){
    it(`${edition}: reads older gold-only sheets without changing their gold or inventing coins`,()=>{
      const {copper:_c,silver:_s,electrum:_e,platinum:_p,...old}=createCharacter('Older sheet',edition);
      old.gold=123.4567;
      const c=characterSchema.parse(old);
      expect(balances(c)).toEqual({copper:0,silver:0,electrum:0,gold:123.4567,platinum:0});
      expect(c).not.toHaveProperty('silver');
      expect(applyCharacterCommand(c,{type:'damage',amount:1}).character.gold).toBe(123.4567);
    });
    it(`${edition}: adds, spends and sets only named denominations`,()=>{
      const c=createCharacter('Coins',edition);c.gold=12.5;c.silver=6;c.copper=4;
      const added=applyCharacterCommand(c,{type:'currency',operation:'add',amounts:{silver:5,platinum:2,electrum:3}}).character;
      expect(balances(added)).toEqual({copper:4,silver:11,electrum:3,gold:12.5,platinum:2});
      const spent=applyCharacterCommand(added,{type:'currency',operation:'spend',amounts:{silver:11,gold:2.5}}).character;
      expect(balances(spent)).toEqual({copper:4,silver:0,electrum:3,gold:10,platinum:2});
      expect(balances(applyCharacterCommand(spent,{type:'currency',operation:'set',amounts:{gold:0,copper:35}}).character)).toEqual({copper:35,silver:0,electrum:3,gold:0,platinum:2});
      expect(c.gold).toBe(12.5);expect(c.silver).toBe(6);
    });
  }
  it('keeps decimal gold exact when adding and spending, including older precision',()=>{
    let c=createCharacter('Fractional gold','5e-2024');c.gold=0.1;
    c=applyCharacterCommand(c,{type:'currency',operation:'add',amounts:{gold:0.2}}).character;expect(c.gold).toBe(0.3);
    c=applyCharacterCommand(c,{type:'currency',operation:'spend',amounts:{gold:0.3}}).character;expect(c.gold).toBe(0);
    c.gold=0.123456789;
    c=applyCharacterCommand(c,{type:'currency',operation:'add',amounts:{gold:1}}).character;expect(c.gold).toBe(1.123456789);
    c.gold=1e-7;
    expect(applyCharacterCommand(c,{type:'currency',operation:'add',amounts:{gold:2e-7}}).character.gold).toBe(3e-7);
  });
  it('rejects overspending atomically without exchanging other denominations',()=>{
    const c=createCharacter('No change','5e-2024');c.gold=500;c.copper=5;
    const before=structuredClone(c);
    expect(()=>applyCharacterCommand(c,{type:'currency',operation:'spend',amounts:{copper:3,silver:1}})).toThrow('Not enough silver');
    expect(c).toEqual(before);
  });
  it('rejects overflow rather than losing coins',()=>{
    const c=createCharacter('Full purse','5e-2024');c.gold=MAX_COINS;
    expect(()=>applyCharacterCommand(c,{type:'currency',operation:'add',amounts:{gold:1}})).toThrow('cannot exceed');
    expect(c.gold).toBe(MAX_COINS);
  });
  it('rejects a change smaller than the stored balance can represent',()=>{
    const c=createCharacter('Precision','5e-2024');c.gold=MAX_COINS;
    expect(()=>applyCharacterCommand(c,{type:'currency',operation:'add',amounts:{gold:0.00000001}})).toThrow('too precise');
    expect(c.gold).toBe(MAX_COINS);
  });
  it.each([{},{silver:-1},{copper:1.5},{electrum:Infinity},{platinum:MAX_COINS+1},{credits:3}])('rejects invalid amounts %j',amounts=>{
    expect(characterCommandSchema.safeParse({type:'currency',operation:'set',amounts}).success).toBe(false);
  });
  it('patches denominations independently and never supplies defaults in an unrelated sheet edit',()=>{
    const c=createCharacter('Patch','5e-2024');c.gold=12;c.silver=4;
    expect(characterSheetPatchSchema.parse({name:'Renamed'})).toEqual({name:'Renamed'});
    const updated=applyCharacterCommand(c,{type:'character-update',changes:{copper:3,platinum:1}}).character;
    expect(balances(updated)).toEqual({copper:3,silver:4,electrum:0,gold:12,platinum:1});
  });
  it('preserves gold from the original save when importing',async()=>{
    const old=defaultState() as {character:{gold:number}};old.character.gold=1735;
    const migrated=await migrateLegacy(old),c=migrated.records.find(r=>r.kind==='character') as Character;
    expect(balances(c)).toEqual({copper:0,silver:0,electrum:0,gold:1735,platinum:0});
    expect(migrated.source.original).toEqual(old);
  });
});

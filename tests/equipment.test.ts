import { describe,expect,it } from 'vitest';
import { createCharacter } from '../src/domain/character';
import { applyCharacterCommand } from '../src/domain/commands';
import { inventoryItemSchema } from '../src/domain/schema';
const item=(id:string,changes:Record<string,unknown>={})=>inventoryItemSchema.parse({id,name:id,quantity:1,weight:3,equipped:false,notes:'',...changes});
describe('equipment commands and loadout boundaries',()=>{
  it('tracks each item, location, equipped status and descriptive weapon properties',()=>{
    const c=createCharacter('Mira','5e-2024');
    const sword=item('longsword',{category:'weapon',weapon:{damage:'1d8',damageType:'Slashing',properties:'Versatile (1d10)',range:'5 feet',ability:'str',proficient:true,bonus:0}});
    const added=applyCharacterCommand(c,{type:'inventory-add',item:sword}).character;
    const equipped=applyCharacterCommand(added,{type:'inventory-equip',itemId:sword.id,equipped:true,slot:'main-hand',replaceIds:[]}).character;
    expect(equipped.inventory[0]).toMatchObject({equipped:true,equipSlot:'main-hand',weapon:{damage:'1d8'}});
    expect(c.inventory).toEqual([]);
  });
  it('requires explicit replacement of occupied hands and never silently changes the loadout',()=>{
    const c={...createCharacter('Mira','5e-2014'),inventory:[item('sword',{equipped:true,equipSlot:'main-hand'}),item('shield',{equipped:true,equipSlot:'off-hand'}),item('greatsword')]};
    expect(()=>applyCharacterCommand(c,{type:'inventory-equip',itemId:'greatsword',equipped:true,slot:'two-hands',replaceIds:[]})).toThrow('Stow');
    const next=applyCharacterCommand(c,{type:'inventory-equip',itemId:'greatsword',equipped:true,slot:'two-hands',replaceIds:['sword','shield']}).character;
    expect(next.inventory.filter(item=>item.equipped).map(item=>item.id)).toEqual(['greatsword']);
  });
  it('rejects zero-quantity, stored and colliding equipped items even through an item edit',()=>{
    const c={...createCharacter('Mira','5e-2024'),inventory:[item('one',{equipped:true,equipSlot:'main-hand'}),item('two')]};
    for(const updated of [item('two',{equipped:true,equipSlot:'main-hand'}),item('two',{equipped:true,quantity:0}),item('two',{equipped:true,location:'stored'})])expect(()=>applyCharacterCommand(c,{type:'inventory-update',item:updated})).toThrow();
  });
  it('imports uncertain legacy items as carried and unweighed without assuming equipment',()=>{
    const c=createCharacter('Mira','5e-2024');
    const result=applyCharacterCommand(c,{type:'inventory-import',items:[item('plate',{weight:0,weightKnown:false,sourceId:'legacy-equipment'})]}).character;
    expect(result.inventory[0]).toMatchObject({equipped:false,location:'carried',weightKnown:false});
    expect(()=>applyCharacterCommand(result,{type:'inventory-add',item:result.inventory[0]})).toThrow('already');
  });
});

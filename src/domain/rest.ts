import {z} from 'zod';
import type {Character} from './schema';

const diceSelection=z.array(z.object({classId:z.string().min(1).max(80),count:z.number().int().min(1).max(20)})).max(20);
export const restCommandSchema=z.object({
  type:z.literal('rest'),kind:z.enum(['short','long']),
  hitDice:diceSelection.optional().describe('Short rest only: hit dice spent, by exact classId. Never roll dice.'),
  healing:z.number().int().min(0).max(99999).optional().describe('Short rest only: total healing resolved at the table, including Constitution and other bonuses.'),
  recoverHitDice:diceSelection.optional().describe('2014 long rest only: choose which spent dice to recover when multiple classes compete for the recovery allowance.'),
  reduceExhaustion:z.boolean().optional().describe('2014 long rest only: true when the character also had sufficient food and drink. 2024 long rests always reduce exhaustion by one.'),
}).strict();

/** Records a completed, qualifying rest. The table adjudicates interruptions and elapsed game time. */
export function applyRest(c:Character,command:z.infer<typeof restCommandSchema>){
  if(c.ruleset==='3.5e')throw new Error('3.5e does not use fifth-edition short/long rest recovery. Use character-update to record recovery resolved with your DM.');
  if(c.hp<=0||c.exhaustion===6||c.conditions.some(name=>name.toLowerCase()==='dead'))throw new Error('This character cannot benefit from this rest in its current state. Resolve recovery with your DM first.');
  const reminders=['Recorded a completed rest; your table must confirm its duration, interruptions and eligibility. Daily and manual resources are unchanged.'];
  const selection=(entries:z.infer<typeof diceSelection>,mode:'spend'|'recover')=>{
    if(new Set(entries.map(e=>e.classId)).size!==entries.length)throw new Error('Choose each hit-die pool only once.');
    for(const entry of entries){
      const pool=c.hitDice.find(p=>p.classId===entry.classId);
      if(!pool||entry.count>(mode==='spend'?pool.maximum-pool.spent:pool.spent))throw new Error('That change exceeds the available hit dice.');
    }
    return entries.reduce((sum,e)=>sum+e.count,0);
  };
  if(command.kind==='short'){
    if(command.recoverHitDice!==undefined||command.reduceExhaustion!==undefined)throw new Error('Hit-die recovery and exhaustion reduction belong to a long rest.');
    const dice=command.hitDice??[],count=selection(dice,'spend');
    if(count>0&&command.healing===undefined)throw new Error('Provide the healing resolved at the table when spending hit dice.');
    if(!count&&(command.healing??0)>0)throw new Error('Short-rest healing requires spent hit dice. Use heal for other resolved healing.');
    if(c.ruleset==='5e-2024'&&count>0&&command.healing!<count)throw new Error('2024 hit dice restore at least 1 HP per die.');
    for(const entry of dice)c.hitDice.find(p=>p.classId===entry.classId)!.spent+=entry.count;
    c.hp=Math.min(c.maxHp,c.hp+(command.healing??0));
    for(const resource of c.resources){
      if(resource.reset==='short')resource.spent=resource.shortRecovery>0?Math.max(0,resource.spent-resource.shortRecovery):0;
      else if(resource.reset==='long'&&resource.shortRecovery>0)resource.spent=Math.max(0,resource.spent-resource.shortRecovery);
    }
    for(const slot of c.slots)if(slot.reset==='short')slot.spent=0;
    return {summary:`Completed short rest${count?`; spent ${count} hit dice; ${command.healing} resolved healing`:''}`,reminders};
  }
  if(command.hitDice!==undefined||command.healing!==undefined)throw new Error('A long rest restores HP without spending hit dice.');
  if(c.ruleset==='5e-2024'){
    if(command.recoverHitDice!==undefined||command.reduceExhaustion!==undefined)throw new Error('2024 long rests recover all hit dice and reduce exhaustion automatically.');
    for(const pool of c.hitDice)pool.spent=0;
    c.exhaustion=Math.max(0,c.exhaustion-1);
    reminders.push('If maximum HP or ability scores were reduced, record their normal values separately; the sheet does not store unreduced baselines.');
  }else{
    const allowance=Math.max(1,Math.floor(c.hitDice.reduce((sum,p)=>sum+p.maximum,0)/2));
    const spent=c.hitDice.reduce((sum,p)=>sum+p.spent,0),recover=Math.min(allowance,spent);
    if(command.recoverHitDice!==undefined){
      if(selection(command.recoverHitDice,'recover')!==recover)throw new Error(`Choose exactly ${recover} spent hit dice to recover.`);
      for(const entry of command.recoverHitDice)c.hitDice.find(p=>p.classId===entry.classId)!.spent-=entry.count;
    }else{
      const pools=c.hitDice.filter(p=>p.spent>0);
      if(pools.length>1&&recover<spent)throw new Error(`Choose which ${recover} spent hit dice to recover for this multiclass character.`);
      let remaining=recover;
      for(const pool of pools){const restored=Math.min(remaining,pool.spent);pool.spent-=restored;remaining-=restored;}
    }
    if(command.reduceExhaustion)c.exhaustion=Math.max(0,c.exhaustion-1);
    else if(c.exhaustion>0)reminders.push('Exhaustion is unchanged. Record reduceExhaustion:true only if sufficient food and drink were available.');
  }
  c.hp=c.maxHp;c.tempHp=0;c.deathSaves={successes:0,failures:0};
  c.concentration=null;c.effects=c.effects.filter(effect=>!effect.concentration);
  for(const resource of c.resources)if(resource.reset==='short'||resource.reset==='long')resource.spent=0;
  for(const slot of c.slots)if(slot.reset!=='manual')slot.spent=0;
  return {summary:'Completed long rest; restored HP, eligible uses, spell slots and hit dice',reminders};
}

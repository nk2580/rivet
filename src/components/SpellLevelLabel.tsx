import type {RulesetId} from '@/domain/schema';
import {Tooltip} from './ui/tooltip';

export function SpellLevelLabel({level,edition,inline=false}:{level:number;edition:RulesetId;inline?:boolean}){
  if(level!==0)return <span className={inline?undefined:'tag'}>Level {level}</span>;
  const explanation=edition==='3.5e'
    ? 'A cantrip is a level 0 arcane spell. Divine casters call level 0 spells orisons. In 3.5e, your class’s daily spell limits still apply.'
    : 'A cantrip is a level 0 spell. Casting one does not spend a spell slot, so you can use a cantrip you know repeatedly. Its casting time, components and concentration rules still apply.';
  return <Tooltip content={explanation}><button type="button" className={inline?'term-help term-help-inline':'tag term-help'} aria-label="Cantrip: what does this mean?">Cantrip</button></Tooltip>;
}

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Pencil} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {COINS,coinBalance,type Coin} from '@/domain/currency';
import {currencyAmountsSchema,MAX_COINS,type Character} from '@/domain/schema';
import type {CharacterCommand} from '@/domain/commands';
import {friendlyError} from '@/lib/errors';
import './currency.css';

type Run=(command:CharacterCommand,expectedRevision?:number)=>Promise<unknown>;
export function CurrencyPurse({character,revision,run}:{character:Character;revision:number;run:Run}){
  const [editing,setEditing]=useState<{revision:number;balances:Record<Coin,number>}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const editButton=useRef<HTMLButtonElement>(null),firstInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(editing)firstInput.current?.focus();},[editing]);
  const close=()=>{setEditing(null);setError('');requestAnimationFrame(()=>editButton.current?.focus());};
  const save=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!editing||busy)return;
    const form=new FormData(event.currentTarget);
    setBusy(true);setError('');
    try{
      const changed=Object.fromEntries(COINS.map(coin=>[coin.key,Number(form.get(coin.key))] as const).filter(([coin,amount])=>amount!==editing.balances[coin]));
      if(!Object.keys(changed).length){close();return;}
      const amounts=currencyAmountsSchema.parse(changed);
      await run({type:'currency',operation:'set',amounts},editing.revision);
      close();
    }catch(failure){setError(friendlyError(failure));}finally{setBusy(false);}
  };
  return <section className="currency-purse" aria-label="Currency">
    <div className="section-heading"><h2>Currency</h2>{!editing&&<Button ref={editButton} variant="outline" size="sm" onClick={()=>{setError('');setEditing({revision,balances:Object.fromEntries(COINS.map(coin=>[coin.key,coinBalance(character,coin.key)])) as Record<Coin,number>});}}><Pencil size={14}/>Edit coins</Button>}</div>
    {editing?<form aria-busy={busy} onSubmit={event=>{void save(event);}}>
      <p className="field-help" id={`currency-help-${character.id}`}>Enter the coins you currently hold. You can undo changes in Details.</p>
      <fieldset disabled={busy} className="currency-fields" aria-describedby={`currency-help-${character.id}`}><legend className="sr-only">Coin balances</legend>{COINS.map((coin,index)=><label className="field" key={coin.key}>{coin.name} ({coin.abbreviation})<input ref={index===0?firstInput:undefined} name={coin.key} type="number" min={0} max={MAX_COINS} step={coin.key==='gold'?'any':1} required defaultValue={editing.balances[coin.key]}/></label>)}</fieldset>
      {error&&<div role="alert" className="notice error">{error}</div>}
      <div className="button-row"><Button type="submit" disabled={busy}>{busy?'Saving…':'Save coins'}</Button><Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button></div>
    </form>:<dl className="currency-balances">{COINS.map(coin=><div key={coin.key}><dt>{coin.name} <span>{coin.abbreviation}</span></dt><dd>{coinBalance(character,coin.key).toLocaleString('en-AU',{maximumSignificantDigits:21})}</dd></div>)}</dl>}
  </section>;
}

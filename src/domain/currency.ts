import type {Character} from './schema';

export const COINS=[
  {key:'copper',name:'Copper',abbreviation:'CP'},
  {key:'silver',name:'Silver',abbreviation:'SP'},
  {key:'electrum',name:'Electrum',abbreviation:'EP'},
  {key:'gold',name:'Gold',abbreviation:'GP'},
  {key:'platinum',name:'Platinum',abbreviation:'PP'},
] as const;
export type Coin=typeof COINS[number]['key'];
export const coinBalance=(character:Character,coin:Coin)=>character[coin]??0;

/** Add decimal gold without floating-point artefacts or rounding old balances. */
export function addCoins(balance:number,change:number):number{
  const parts=(value:number)=>{
    const [coefficient,exponent='0']=String(value).split('e');
    const [whole,fraction='']=coefficient.split('.');
    return {digits:BigInt(whole+fraction),scale:fraction.length-Number(exponent)};
  };
  const a=parts(balance),b=parts(change),scale=Math.max(0,a.scale,b.scale);
  const sum=a.digits*10n**BigInt(scale-a.scale)+b.digits*10n**BigInt(scale-b.scale);
  const result=Number(`${sum}e-${scale}`),recorded=parts(result),checkScale=Math.max(scale,recorded.scale);
  if(sum*10n**BigInt(checkScale-scale)!==recorded.digits*10n**BigInt(checkScale-recorded.scale))throw new Error('That coin change is too precise to record. Use a larger amount.');
  return result;
}

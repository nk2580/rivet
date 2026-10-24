import { calculate } from '@/domain/character';
import type { Character } from '@/domain/schema';
import type { CharacterCommand } from '@/domain/commands';
import { signed } from '@/lib/utils';

export function EquipmentCalculations({character:c,busy,onChange}:{character:Character;busy:boolean;onChange:(command:CharacterCommand)=>void}){
  const ac=calculate(c,'armorClass'),movement=calculate(c,'speed');
  return <details className="equipment-calculations"><summary>Armour and movement · AC {ac.total} · {movement.total} ft</summary>
    <label className="check-field"><input type="checkbox" checked={c.equipmentRules} disabled={busy} onChange={event=>onChange({type:'equipment-rules',enabled:event.target.checked,armorTraining:c.armorTraining})}/>Use equipped gear for AC and movement</label>
    <p className="small-print">{c.equipmentRules?'Equipped armour, shields and their Dexterity or Strength limits drive these values.':`Using your reviewed AC ${c.armorClass} and base speed. Enable this after you confirm your loadout.`} Explicit DM overrides still apply.</p>
    <div className="form-grid">{[ac,movement,...(c.ruleset==='3.5e'?[calculate(c,'touchArmorClass'),calculate(c,'flatFootedArmorClass')]:[])].map(result=><div key={result.label}><strong>{result.label==='armorClass'?'Armour class':result.label==='speed'?'Movement':result.label==='touchArmorClass'?'Touch AC':'Flat-footed AC'} · {result.total}</strong><ul className="calculation-terms">{result.terms.map((t,index)=><li key={index}><span>{t.label}</span><span>{signed(t.value)}</span></li>)}</ul></div>)}</div>
    {c.ruleset!=='3.5e'&&<fieldset><legend>Armour training</legend><p className="small-print">Confirm training from your classes and features. A 2024 shield adds AC only with shield training.</p>{(['light','medium','heavy','shield'] as const).map(training=><label className="check-field" key={training}><input type="checkbox" checked={c.armorTraining.includes(training)} disabled={busy} onChange={event=>onChange({type:'equipment-rules',enabled:c.equipmentRules,armorTraining:event.target.checked?[...c.armorTraining,training]:c.armorTraining.filter(value=>value!==training)})}/>{training==='shield'?'Shields':`${training.charAt(0).toUpperCase()+training.slice(1)} armour`}</label>)}</fieldset>}
  </details>;
}

import {abilityNames,type Character} from '@/domain/schema';

/** Values recorded through Oracle remain inspectable on the sheet itself. */
export function SheetMechanics({character:c}:{character:Character}){
  return <>
    <section className="sheet-section"><h2>Training & recovery</h2><dl className="detail-list">
      <div><dt>Spellcasting ability</dt><dd>{abilityNames[c.spellAbility]}</dd></div>
      <div><dt>Armour training</dt><dd>{c.armorTraining.join(', ')||'None recorded'}</dd></div>
      {c.ruleset==='3.5e'?<>
        {Object.entries(c.saves).map(([name,value])=><div key={name}><dt>{name} save</dt><dd>{value>=0?'+':''}{value}</dd></div>)}
        <div><dt>Nonlethal damage</dt><dd>{c.nonlethalDamage}</dd></div><div><dt>Stable</dt><dd>{c.stable?'Yes':'No'}</dd></div>
      </>:<>
        <div><dt>Saving throw proficiencies</dt><dd>{c.saveProficiencies.map(a=>abilityNames[a]).join(', ')||'None recorded'}</dd></div>
        <div><dt>Exhaustion</dt><dd>{c.exhaustion}</dd></div><div><dt>Inspiration</dt><dd>{c.inspiration?'Available':'None'}</dd></div>
        <div><dt>Death saves</dt><dd>{c.deathSaves.successes} successes · {c.deathSaves.failures} failures</dd></div>
        {c.hitDice.map(pool=><div key={pool.classId}><dt>{c.classes.find(cl=>cl.classId===pool.classId)?.name??pool.classId} hit dice</dt><dd>{pool.maximum-pool.spent} / {pool.maximum} d{pool.size} available</dd></div>)}
      </>}
    </dl>
    <h3>{c.ruleset==='3.5e'?'Skill ranks':'Skill training'}</h3>
    <dl className="detail-list">{Object.entries(c.ruleset==='3.5e'?c.skillRanks:c.skills).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{c.ruleset==='3.5e'?value:['Untrained','Proficient','Expertise'][value]}</dd></div>)}</dl>
    {!Object.keys(c.ruleset==='3.5e'?c.skillRanks:c.skills).length&&<p className="muted">No skill training recorded.</p>}
    </section>
    {!!c.feats.length&&<section className="sheet-section"><h2>Feats</h2><ul>{c.feats.map((feat,index)=><li key={index}>{feat}</li>)}</ul></section>}
    {!!c.effects.length&&<section className="sheet-section"><h2>Active effects</h2>{c.effects.map(effect=><div key={effect.id} className="information-row"><div><strong>{effect.name}</strong><small>{effect.duration} · {effect.source}</small>{effect.modifiers.map((modifier,index)=><small key={index}>{modifier.target}: {modifier.value>=0?'+':''}{modifier.value} {modifier.type}</small>)}</div></div>)}</section>}
    {!!c.overrides.length&&<section className="sheet-section"><h2>Table rulings</h2><dl className="detail-list">{c.overrides.map(override=><div key={override.id}><dt>{override.target}</dt><dd>{override.value} · {override.reason}</dd></div>)}</dl></section>}
  </>;
}

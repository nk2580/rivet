// Read-only acceptance evidence. Never queries credentials or exports chat text.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';

const id='oracle-live-qa-20261023';
const db=new DatabaseSync(join(homedir(),'Library/Application Support/Rivet/workspace.sqlite'),{readOnly:true});
try{
  const row=db.prepare("SELECT payload FROM documents WHERE key=?").get(`local/character/${id}`);
  if(!row)throw new Error('Synthetic live acceptance character is missing.');
  const document=JSON.parse(row.payload),c=document.data;
  const activity=db.prepare("SELECT payload FROM activity WHERE json_extract(payload,'$.characterId')=? ORDER BY rowid").all(id).map(row=>JSON.parse(row.payload));
  const commands=activity.map(entry=>({type:JSON.parse(entry.commandSignature).type,undone:entry.undone}));
  const tools=db.prepare("SELECT m.status,m.text,m.details FROM chat_messages m JOIN chat_sessions s ON m.session_id=s.id WHERE s.character_id=? AND m.role='tool' ORDER BY m.rowid").all(id).map(row=>({tool:row.text,status:row.status,command:JSON.parse(row.details)?.arguments?.command?.type}));
  const pending=db.prepare("SELECT m.details FROM chat_messages m JOIN chat_sessions s ON m.session_id=s.id WHERE s.character_id=? AND m.role='proposal' AND m.status='pending'").all(id).map(row=>{const details=JSON.parse(row.details);return {type:details.command.type,current:details.revision===document.localRevision};});
  const fingerprints=JSON.parse(readFileSync('.local/oracle-sweep-20261023/user-character-fingerprints.json','utf8'));
  const unchanged=Object.entries(fingerprints).every(([key,hash])=>{const row=db.prepare('SELECT payload FROM documents WHERE key=?').get(key);return row&&createHash('sha256').update(row.payload).digest('hex')===hash;});
  const required=['damage','heal','temporary-hp','condition','resource','slot','concentration','spell-cast','inventory-add','inventory-import','inventory-update','inventory-remove','inventory-equip','equipment-rules','spell-add','spell-update','spell-remove','spell-prepare'];
  const missing=required.filter(type=>!commands.some(command=>command.type===type));
  const privateNotesPreserved=['sword','shield','rope','plate','greatsword'].every(id=>c.inventory.find(item=>item.id===id)?.notes==='PRIVATE ITEM NOTE')&&c.spells.find(spell=>spell.id==='bolt')?.notes==='PRIVATE SPELL NOTE';
  const result={privateNotesPreserved,allCommandTypesObserved:missing.length===0,missingCommandTypes:missing,characterId:id,archived:document.deleted,revision:document.localRevision,existingCharactersUnchanged:unchanged,
    sheet:{hp:c.hp,tempHp:c.tempHp,concentration:c.concentration,conditions:c.conditions,slots:c.slots,resources:c.resources.map(({id,spent,maximum})=>({id,spent,maximum})),inventory:c.inventory.map(({id,name,quantity,equipped,notes})=>({id,name,quantity,equipped,hasOriginalPrivateNote:notes==='PRIVATE ITEM NOTE'})),spells:c.spells.map(({id,name,prepared,range,notes})=>({id,name,prepared,range,hasOriginalPrivateNote:notes==='PRIVATE SPELL NOTE'})),equipmentRules:c.equipmentRules},
    appliedCommandTypes:[...new Set(commands.map(c=>c.type))].sort(),actionCount:activity.length,toolCalls:tools.length,toolErrors:tools.filter(t=>t.status==='error'),pendingReviewTypes:pending.filter(p=>p.current).map(p=>p.type),staleReviewCount:pending.filter(p=>!p.current).length};
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!unchanged||!privateNotesPreserved||(process.argv.includes('--require-complete')&&missing.length))process.exitCode=1;
}finally{db.close();}

import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {oracleFixture,toolCall,oracleAnswer} from './fixtures/oracle';

describe('native Oracle acceptance workspace',()=>{
  it('prepares an isolated, credential-free workspace with a direct receipt and a pending reviewed edit',async()=>{
    const f=await oracleFixture();
    try{
      const result=await f.turn((_request,round)=>{
        if(round===0)return [toolCall('apply_character_action',{command:{type:'damage',amount:10},expectedRevision:1,reason:'Resolved damage for native acceptance.'})];
        if(round===1){const {notes,...item}=f.character.inventory.find(i=>i.id==='rope')!;return [toolCall('propose_character_action',{command:{type:'inventory-update',item:{...item,quantity:3}},reason:'Change rope quantity to three; preserve the private note.'})];}
        return [oracleAnswer];
      });
      expect(result.messages.find((m:any)=>m.role==='action')).toMatchObject({details:{canUndo:true}});
      expect(result.messages.find((m:any)=>m.role==='proposal')?.status).toBe('pending');
      expect(f.store.connection.prepare("SELECT key FROM meta WHERE key LIKE 'auth/%'").all()).toEqual([]);
      if(process.env.RIVET_NATIVE_QA_DIR){
        const directory=resolve(process.env.RIVET_NATIVE_QA_DIR),allowed=resolve('.local')+sep;
        if(!directory.startsWith(allowed))throw new Error('Native acceptance output must be inside this project’s .local folder.');
        await mkdir(directory,{recursive:true});
        f.store.connection.prepare('VACUUM INTO ?').run(join(directory,'workspace.sqlite'));
        await writeFile(join(directory,'fixture.json'),JSON.stringify({characterId:f.character.id,sessionId:f.session.id,expected:{hp:24,tempHp:0,ropeQuantity:2}},null,2));
        const backup=await f.workspace.exportBackup();
        await writeFile(join(directory,'live-qa-import.json'),JSON.stringify({...backup,records:backup.records.filter(record=>record.id===f.character.id).map(record=>({...record,id:'oracle-live-qa-20261023',name:'Oracle live QA (test character)'}))},null,2));
      }
    }finally{await f.close();}
  });
});

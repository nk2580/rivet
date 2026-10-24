import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {describe,expect,it} from 'vitest';
import {oracleAnswer,oracleFixture,sameSheet,toolCall} from './fixtures/oracle';
import type {Character} from '../src/domain/schema';

describe('Oracle full-sheet and limited-use ability workflow',()=>{
  it('reviews an atomic sheet setup, spends an ability, completes a rest, and undoes recovery across restart',async()=>{
    const f=await oracleFixture();
    try{
      f.character.notes='PRIVATE SHEET NOTE';f.character.backstory='PRIVATE BACKSTORY';f.character.features='Known sheet mechanic';
      await f.workspace.save(f.character,1);
      const before=(await f.workspace.get('character',f.character.id))!;
      const result=await f.turn((request,round)=>{
        if(round===0){expect(request.instructions).toContain('Known sheet mechanic');expect(request.instructions).not.toContain('PRIVATE SHEET NOTE');expect(request.instructions).not.toContain('PRIVATE BACKSTORY');return [toolCall('get_character',{})];}
        if(round===1){
          const read=JSON.parse(request.input.findLast((entry:any)=>entry.type==='function_call_output').output);
          expect(read.character).not.toHaveProperty('notes');expect(read.character.features).toBe('Known sheet mechanic');
          return [toolCall('propose_character_action',{command:{type:'character-update',changes:{abilities:{wis:18},features:'Known sheet mechanic\nTable ability: three uses per long rest.',resources:[...read.character.resources,{id:'table-ability',name:'Table ability',description:'A table-approved ability with three uses per long rest.',maximum:3,spent:0,reset:'long',shortRecovery:0}]}},reason:'Set Wisdom to 18 and add the requested table ability with three uses per long rest.'})];
        }
        return [oracleAnswer];
      });
      expect(await f.workspace.get('character',f.character.id)).toEqual(before);
      const proposal=result.messages.find((m:any)=>m.role==='proposal')!;
      await f.runtime.applyProposal(proposal.details.id);
      const configured=(await f.workspace.get('character',f.character.id))!.data as Character;
      expect(configured).toMatchObject({abilities:{wis:18},notes:'PRIVATE SHEET NOTE',backstory:'PRIVATE BACKSTORY'});
      expect(configured.resources.at(-1)).toMatchObject({maximum:3,spent:0,reset:'long'});
      const turn=async(command:unknown,prompt:string)=>f.turn((request,round)=>round===0?[toolCall('get_character',{})]:round===1?[toolCall('apply_character_action',{command,expectedRevision:JSON.parse(request.input.findLast((entry:any)=>entry.type==='function_call_output').output).revision,reason:prompt})]:[oracleAnswer],prompt);
      await turn({type:'resource',resourceId:'table-ability',change:1},'Use my table ability once.');
      expect(((await f.workspace.get('character',f.character.id))!.data as Character).resources.at(-1)?.spent).toBe(1);
      const spent=(await f.workspace.get('character',f.character.id))!.data as Character;
      await turn({type:'rest',kind:'long'},'I have finished a qualifying long rest.');
      expect((await f.workspace.get('character',f.character.id))!.data).toMatchObject({hp:48,tempHp:0,resources:[{spent:0},{spent:0}]});
      const restReceipt=f.runtime.messages(f.session.id).messages.filter((m:any)=>m.role==='action').at(-1)!;
      await f.restart();await f.runtime.undoAction(restReceipt.id);
      expect(sameSheet((await f.workspace.get('character',f.character.id))!.data as Character)).toEqual(sameSheet(spent));
      // A second reviewed change provides a concrete Apply/Undo target for native QA.
      await f.turn((_request,round)=>round===0?[toolCall('propose_character_action',{command:{type:'resource-update',resource:{id:'table-ability',maximum:4}},reason:'Raise the table ability to four uses per long rest, preserving the one spent use.'})]:[oracleAnswer]);
      if(process.env.RIVET_FULL_SHEET_QA_DIR){
        const directory=resolve(process.env.RIVET_FULL_SHEET_QA_DIR);
        if(!directory.startsWith(resolve('.local')+sep))throw new Error('Native QA must use this project’s .local folder.');
        await mkdir(directory,{recursive:true});f.store.connection.prepare('VACUUM INTO ?').run(join(directory,'workspace.sqlite'));
        await writeFile(join(directory,'fixture.json'),JSON.stringify({characterId:f.character.id,sessionId:f.session.id},null,2));
      }
    }finally{await f.close();}
  });
});

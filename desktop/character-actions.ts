import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import {characterCommandSchema,routineCharacterCommandSchema,routineCommandTypes,resolveCharacterCommand} from '../src/domain/commands';
import {documentKey,type Workspace} from '../src/storage/workspace';
import type {SQLiteStore} from './sqlite';
import type {ActivityEntry} from '../src/storage/database';

const embeddedSchema=(schema:z.ZodType)=>{const {$schema,...json}=z.toJSONSchema(schema,{target:'draft-7'});return json;};
export const applyCharacterActionParameters={type:'object',properties:{command:embeddedSchema(routineCharacterCommandSchema),expectedRevision:{type:'integer',minimum:1,description:'The revision returned by get_character immediately before this edit.'},reason:{type:'string',minLength:1,maxLength:2000,description:'The user’s requested change.'}},required:['command','expectedRevision','reason'],additionalProperties:false};
export const proposeCharacterActionParameters={type:'object',properties:{command:embeddedSchema(characterCommandSchema),reason:{type:'string',minLength:1,maxLength:2000}},required:['command','reason'],additionalProperties:false};
type AppliedAction={applied:true;receiptId:string;summary:string;reminders:string[];revision:number}|{applied:false;undone:true;receiptId?:string;error:string};

/** The sheet mutation and its visible receipt commit together in the same SQLite transaction. */
export class CharacterActions {
  constructor(private store:SQLiteStore,private workspace:Workspace){}
  private recordReceipt(sessionId:string,characterId:string,receipt:ActivityEntry,reason:string){
    const existing=this.store.connection.prepare("SELECT id FROM chat_messages WHERE session_id=? AND role='action' AND json_extract(details,'$.commandId')=?").get(sessionId,receipt.commandId);
    if(existing)return String(existing.id);
    const id=randomUUID(),details={characterId,commandId:receipt.commandId,receiptKey:receipt.key,reason,summary:receipt.summary,reminders:receipt.reminders};
    this.store.connection.prepare("INSERT INTO chat_messages VALUES(?,?,'action',?,'applied',?,?)").run(id,sessionId,receipt.summary,JSON.stringify(details),new Date().toISOString());
    return id;
  }
  async apply(sessionId:string,characterId:string,input:unknown,expectedRevision:number,reason:string,callId:string){
    const current=await this.workspace.get('character',characterId);
    if(!current||current.deleted||current.data.kind!=='character')throw new Error('Select an active character.');
    const session=this.store.connection.prepare('SELECT character_id,edition FROM chat_sessions WHERE id=?').get(sessionId);
    if(!session||session.character_id!==characterId||session.edition!==current.data.ruleset)throw new Error('This update does not match the session’s character and edition.');
    const command=resolveCharacterCommand(input,current.data);
    if(!routineCommandTypes.has(command.type))throw new Error('This change needs review. Use propose_character_action.');
    const revision=z.number().int().min(1).parse(expectedRevision),explanation=z.string().trim().min(1).max(2000).parse(reason);
    const commandId='oracle-'+createHash('sha256').update(sessionId+'\0'+z.string().min(1).max(1000).parse(callId)).digest('hex');
    return this.store.transaction<AppliedAction>(async()=>{
      const receipt=await this.workspace.execute(characterId,command,revision,commandId);
      const message=this.store.connection.prepare("SELECT id FROM chat_messages WHERE session_id=? AND role='action' AND json_extract(details,'$.commandId')=?").get(sessionId,commandId);
      if(receipt.undone)return {applied:false,undone:true,receiptId:message?String(message.id):undefined,error:'This earlier action was undone. Ask the user before applying a new action.'};
      const receiptId=this.recordReceipt(sessionId,characterId,receipt,explanation);
      return {applied:true,receiptId,summary:receipt.summary,reminders:receipt.reminders,revision:receipt.resultingRevision};
    });
  }
  async review(id:string){
    return this.store.transaction<{receipt:ActivityEntry;sessionId:string;characterId:string}>(async()=>{
      const row=await this.store.meta.get(`proposal/${id}`),proposal=row?.value as any;
      if(!proposal||proposal.applied)throw new Error('This proposal is unavailable or already applied.');
      const current=await this.workspace.get('character',proposal.characterId);
      if(!current||current.deleted||current.data.kind!=='character')throw new Error('Select an active character.');
      const session=this.store.connection.prepare('SELECT character_id,edition FROM chat_sessions WHERE id=?').get(proposal.sessionId);
      if(!session||session.character_id!==proposal.characterId||session.edition!==proposal.edition||current.data.ruleset!==proposal.edition)throw new Error('The character edition changed or does not match this session.');
      const command=characterCommandSchema.parse(proposal.command);
      const receipt=await this.workspace.execute(proposal.characterId,command,proposal.revision,proposal.id);
      if(receipt.undone)throw new Error('This earlier action was undone. Propose a new action to apply it again.');
      this.recordReceipt(proposal.sessionId,proposal.characterId,receipt,proposal.reason);
      await this.store.meta.put({key:`proposal/${id}`,value:{...proposal,applied:true}});
      this.store.connection.prepare("UPDATE chat_messages SET status='applied' WHERE session_id=? AND role='proposal' AND json_extract(details,'$.id')=?").run(proposal.sessionId,id);
      return {receipt,sessionId:String(proposal.sessionId),characterId:String(proposal.characterId)};
    });
  }
  state(characterId:string,details:{receiptKey?:string}){
    if(!details.receiptKey)return {canUndo:false,undone:false};
    const current=this.store.connection.prepare("SELECT json_extract(payload,'$.undoHead') AS head FROM documents WHERE key=?").get(documentKey(this.workspace.ownerUid,'character',characterId));
    const receipt=this.store.connection.prepare("SELECT json_extract(payload,'$.undone') AS undone FROM activity WHERE key=?").get(details.receiptKey);
    return {canUndo:!!receipt&&!receipt.undone&&current?.head===details.receiptKey,undone:!!receipt?.undone};
  }
  async undo(messageId:string){
    return this.store.transaction<{sessionId:string;characterId:string;summary:string}>(async()=>{
      const message=this.store.connection.prepare("SELECT * FROM chat_messages WHERE id=? AND role='action'").get(messageId);
      if(!message)throw new Error('This character update is unavailable.');
      const details=JSON.parse(String(message.details));
      await this.workspace.undo(z.string().parse(details.receiptKey));
      this.store.connection.prepare("UPDATE chat_messages SET status='undone' WHERE id=?").run(messageId);
      return {sessionId:String(message.session_id),characterId:String(details.characterId),summary:'Undid '+String(message.text)};
    });
  }
}

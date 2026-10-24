import { describe, expect, it } from 'vitest';
import { createCharacter } from '../src/domain/character';
import { emptyNoteDraft, guideNotebookContext, noteDraftSchema } from '../src/domain/notebook';
import { recordBase, type Note, type Session } from '../src/domain/schema';
describe('notebook drafts and guide source boundaries',()=>{
  it('retains every composing choice and keeps new notes private until shared',()=>{
    const draft={...emptyNoteDraft('session-1'),editingId:'note-1',baseRevision:9,title:'A promise',body:'Find the missing scout',noteType:'goal' as const,carry:true,scope:'character' as const,tags:'party, urgent',linkedIds:['npc-1']};
    expect(noteDraftSchema.parse(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(draft.share).toBe(false);
  });
  it('excludes private, other-character, other-campaign, future and archived context including links',()=>{
    const character={...createCharacter('Mira','5e-2024'),campaignId:'campaign'};
    const session=(id:string,date:string):Session=>({...recordBase(id),id,kind:'session',campaignId:'campaign',date,characterIds:[character.id],summary:'This unshared summary must stay private'});
    const note=(id:string,change:Partial<Note>={}):Note=>({...recordBase(id),id,kind:'note',campaignId:'campaign',characterId:null,sessionId:'current',body:`Body ${id}`,noteType:'fact',tags:[],linkedIds:[],shareWithGuide:true,carryForward:false,status:'open',...change});
    const records=[session('past','2026-10-01'),session('current','2026-10-10'),session('future','2026-10-20'),note('shared',{linkedIds:['private','carry']}),note('private',{shareWithGuide:false}),note('someone-else',{characterId:'another'}),note('another-campaign',{campaignId:'elsewhere'}),note('archived',{status:'archived'}),note('not-carried',{sessionId:'past'}),note('future-note',{sessionId:'future',carryForward:true}),note('carry',{sessionId:'past',carryForward:true})];
    const context=guideNotebookContext(records,character,'current');
    expect(context.map(n=>n.id).sort()).toEqual(['carry','shared']);
    expect(context.find(n=>n.id==='shared')?.linkedIds).toEqual(['carry']);
    expect(context.find(n=>n.id==='carry')?.sourceSession).toMatchObject({id:'past'});
    expect(JSON.stringify(context)).not.toContain('unshared summary');
  });
});

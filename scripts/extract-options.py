"""Inventory character options from the complete versioned primary sources.

This is a content catalogue. It deliberately preserves prerequisite and benefit
text instead of inventing mechanical automation from prose.
"""
from pathlib import Path
import importlib.util,json,re

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('srd',ROOT/'scripts/extract-srd.py');srd=importlib.util.module_from_spec(spec);spec.loader.exec_module(srd)
spec35=importlib.util.spec_from_file_location('srd35',ROOT/'scripts/extract-srd35.py');rtf=importlib.util.module_from_spec(spec35);spec35.loader.exec_module(rtf)
CLASSES=['Barbarian','Bard','Cleric','Druid','Fighter','Monk','Paladin','Ranger','Rogue','Sorcerer','Warlock','Wizard']
def slug(text):return re.sub('[^a-z0-9]+','-',text.lower()).strip('-')
def entry(name,lines):
    return {'id':slug(name),'name':name,'page':lines[0]['page'],'description':srd.prose(lines[1:])}
def sections(lines,positions):
    return [(name,lines[start:positions[n+1][0] if n+1<len(positions) else len(lines)]) for n,(start,name) in enumerate(positions)]
def extract(version,modern):
    header=json.loads((ROOT/'public/rules'/f'srd-{version}-spells.json').read_text());header.pop('spells')
    lines=[]
    for path in sorted((ROOT/'.local/srd'/f'reference-{version}').glob('*.json'),key=lambda p:int(p.stem)):lines.extend(json.loads(path.read_text())['lines'])
    lower,upper=(28,83) if modern else (8,59)
    class_lines=[line for line in lines if lower<=line['page']<upper]
    # The 2014 Wizard ends before the next chapter, not at a page boundary.
    class_end=next((i for i,line in enumerate(class_lines) if line['text']=='Beyond 1st Level'),len(class_lines))
    class_lines=class_lines[:class_end]
    starts=[(i,line['text']) for i,line in enumerate(class_lines) if line['size']>=17 and line['text'] in CLASSES]
    if [name for _,name in starts]!=CLASSES:raise ValueError('Class inventory mismatch')
    classes=[]
    for name,body in sections(class_lines,starts):
        text=srd.prose(body);hit=re.search(r'Hit (?:Point Die\s+D|Dice:\s+1d)(\d+)',text,re.I)
        if not hit:raise ValueError('Missing class hit die '+name)
        features=[]
        headings=[(i,line['text']) for i,line in enumerate(body) if i>0 and 11.8<=line['size']<17]
        for i,(start,title) in enumerate(headings):
            stop=headings[i+1][0] if i+1<len(headings) else len(body)
            # A larger parent heading also ends a child feature.
            stop=next((j for j in range(start+1,stop) if body[j]['size']>=17),stop)
            feature=entry(title,body[start:stop]);feature['id']=f'{slug(name)}-{slug(title)}-{feature["page"]}-{i}'
            level=re.match(r'^Level (\d+): (.+)',title)
            if level:feature['level']=int(level[1]);feature['name']=level[2]
            features.append(feature)
        classes.append({**entry(name,body),'hitDie':int(hit[1]),'endPage':body[-1]['page'],'features':features})
    species_names=['Dragonborn','Dwarf','Elf','Gnome','Goliath','Halfling','Human','Orc','Tiefling'] if modern else ['Dwarf','Elf','Halfling','Human','Dragonborn','Gnome','Half-Elf','Half-Orc','Tiefling']
    source=[line for line in lines if (84<=line['page']<=86 if modern else 3<=line['page']<=7)]
    starts=[(i,line['text']) for i,line in enumerate(source) if line['text'] in species_names and (11.8<line['size']<12.2 if modern else line['size']>=17)]
    if sorted(name for _,name in starts)!=sorted(species_names):raise ValueError('Species inventory mismatch')
    species=[entry(name,body) for name,body in sections(source,starts)]
    if modern:
        # This table spans both columns beneath the Human and Tiefling prose.
        # Column-order PDF extraction must not give Human a fiendish legacy.
        table_lines=[line for line in source if line['page']==86 and line['y']<=155]
        human=next(item for item in species if item['id']=='human')
        human['description']=human['description'].split('Fiendish Legacies')[0].rstrip()
        tiefling=next(item for item in species if item['id']=='tiefling')
        tiefling['description']=tiefling['description'].split('\n\nLevel 3 Level 5')[0].rstrip()+'\n\n'+srd.prose(table_lines)
    source=[line for line in lines if (line['page']==83 if modern else line['page'] in [60,61])]
    names=['Acolyte','Criminal','Sage','Soldier'] if modern else ['Acolyte']
    starts=[(i,line['text']) for i,line in enumerate(source) if line['text'] in names and line['size']>11.8]
    backgrounds=[]
    for name,body in sections(source,starts):
        end=next((i for i,line in enumerate(body[1:],1) if line['size']>=17),len(body));backgrounds.append(entry(name,body[:end]))
    source=[line for line in lines if (87<=line['page']<=88 if modern else line['page']==75)]
    starts=[(i,line['text']) for i,line in enumerate(source) if (11.8<line['size']<12.2 if modern else line['text']=='Grappler' and 13<line['size']<15)]
    feats=[]
    for name,body in sections(source,starts):
        end=next((i for i,line in enumerate(body[1:],1) if line['size']>=13),len(body));feats.append(entry(name,body[:end]))
    header['modifications']='Source headings inventoried as character options and feature sections. Explicit 2024 level labels retained; prose prerequisites and benefits remain source text. Tables retain their exact layout in the included original PDF.'
    output=ROOT/'public/rules'/f'srd-{version}-options.json';output.write_text(json.dumps({**header,'classes':classes,'species':species,'backgrounds':backgrounds,'feats':feats},ensure_ascii=False,indent=2)+'\n')
    print(version,len(classes),'classes;',sum(len(c['features']) for c in classes),'feature sections;',len(species),'species;',len(backgrounds),'backgrounds;',len(feats),'feats',flush=True)

def rtf_entry(name,body,document):
    blocks=[{k:v for k,v in b.items() if k not in {'size','italic'}} for b in body[1:]]
    return {'id':slug(name),'name':name,'document':document,'description':rtf.text_blocks(body[1:]),'blocks':blocks}
def rtf_sections(blocks,starts):return [(name,blocks[start:starts[i+1][0] if i+1<len(starts) else len(blocks)]) for i,(start,name) in enumerate(starts)]
def extract35():
    header=json.loads((ROOT/'public/rules/srd-3.5-spells.json').read_text());header.pop('spells');classes=[];prestige=[]
    for document in ['ClassesI','ClassesII','PrestigeClasses']:
        blocks=rtf.blocks(rtf.HTML/(document+'.html'));is_prestige=document=='PrestigeClasses'
        starts=[(i,b['text'].title()) for i,b in enumerate(blocks) if b['type']=='paragraph' and (b['size']==12 and b['text'].isupper() and b['text']!='Definitions of Terms'.upper() if is_prestige else b['size']>=17 and b['text'] not in {'CLASSES I','CLASSES II'})]
        for name,body in rtf_sections(blocks,starts):
            if name=='Multiclass Characters':continue
            result=rtf_entry(name,body,document+'.rtf')
            match=re.search(r'Hit Die:\s*d(\d+)',result['description'],re.I)
            if not match:raise ValueError('Missing 3.5 hit die: '+name)
            result['hitDie']=int(match[1]);(prestige if is_prestige else classes).append(result)
    blocks=rtf.blocks(rtf.HTML/'Races.html');starts=[(i,b['text'].title()) for i,b in enumerate(blocks) if b['type']=='paragraph' and b['size']>=17 and b['text']!='RACES']
    species=[rtf_entry(name,body,'Races.rtf') for name,body in rtf_sections(blocks,starts)]
    # 19 genuine source headings use 10pt rather than 12pt. Heading syntax,
    # rather than font size, is authoritative; exclude the template example.
    blocks=rtf.blocks(rtf.HTML/'Feats.html');starts=[(i,b['text'].title()) for i,b in enumerate(blocks) if b['type']=='paragraph' and re.fullmatch(r'[A-Z0-9 ()’\'\-,]+ \[(?:GENERAL|ITEM CREATION|METAMAGIC|SPECIAL)\]',b['text'])]
    feats=[rtf_entry(name,body,'Feats.rtf') for name,body in rtf_sections(blocks,starts)]
    header['modifications']='Core class, prestige class, race and feat headings inventoried from original RTF source files. Full source paragraphs and tables retained; prerequisites and benefits remain source text.'
    output=ROOT/'public/rules/srd-3.5-options.json';output.write_text(json.dumps({**header,'classes':classes,'prestigeClasses':prestige,'species':species,'backgrounds':[],'feats':feats},ensure_ascii=False,indent=2)+'\n')
    print('3.5',len(classes),'base classes;',len(prestige),'prestige classes;',len(species),'races;',len(feats),'feats',flush=True)

if __name__=='__main__':extract('5.2.1',True);extract('5.1',False);extract35()

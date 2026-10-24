"""Reproducible, baseline-aware extraction from the official CC-BY SRD PDFs.

Requires pdfplumber. PDF sources are cached in .local/srd; generated packs retain
source pages and SHA-256 provenance. No game outcomes are generated.
"""
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
import pdfplumber

ROOT=Path(__file__).resolve().parent.parent
SCHOOLS='Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation'
META=re.compile(rf'^(?:Level ([1-9]) ({SCHOOLS})|([1-9])(?:st|nd|rd|th)-level ({SCHOOLS})|({SCHOOLS}) [Cc]antrip)',re.I)

def clean(text):
    text=text.replace('\u00ad','')
    for dash in '\u2010\u2011\u2012\u2013\u2014':text=text.replace(dash,'-')
    text=re.sub(r'-{2,}','-',text)
    return re.sub(r'\s+',' ',text).strip()

def page_lines(page,index):
    result=[]
    for column in range(2):
        groups=defaultdict(list)
        for char in page.chars:
            baseline=char['matrix'][5]
            if not 40<baseline<page.height-20:continue
            if int(char['x0']>=page.width/2)!=column:continue
            groups[round(baseline*2)/2].append(char)
        for baseline,chars in sorted(groups.items(),reverse=True):
            chars.sort(key=lambda char:char['x0'])
            raw='';last=None
            for char in chars:
                if last and char['x0']-last['x1']>max(1.5,char['size']*.22) and not raw.endswith((' ','\t','\n','\r')):raw+=' '
                raw+=char['text'];last=char
            text=clean(raw)
            if text:result.append({'text':text,'page':index+1,'column':column,'y':baseline,'size':max(char['size'] for char in chars),'paragraph':bool(raw[:1].isspace())})
    return result

def prose(lines):
    paragraphs=[];current='';previous=None
    for line in lines:
        text=line['text']
        new=line['paragraph'] or (previous and line['page']==previous['page'] and line['column']==previous['column'] and previous['y']-line['y']>15)
        if new and current:paragraphs.append(current);current=''
        if current.endswith('-') and text[:1].islower():
            fragment=re.search(r'([A-Za-z]+)-$',current)
            keep=fragment and fragment.group(1).lower() in {'higher','lower','half','one','two','three','four','five','six','long','short','self','non','extra','spell'}
            current=(current if keep else current[:-1])+text
        else:current+=(' ' if current else '')+text
        previous=line
    if current:paragraphs.append(current)
    return '\n\n'.join(paragraphs)

def extract(version,edition,last_page):
    path=ROOT/'.local/srd'/f'SRD_CC_v{version}.pdf'
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    cache=path.with_suffix('.lines.json')
    cached=json.loads(cache.read_text()) if cache.exists() else None
    if cached and cached.get('digest')==digest and cached.get('lastPage')==last_page and cached.get('cacheVersion')==1:rows=cached['rows']
    else:
        rows=[]
        with pdfplumber.open(path) as document:
            for index,page in enumerate(document.pages[:last_page]):
                if index<100:continue
                rows.extend(page_lines(page,index))
                page.close()
        cache.write_text(json.dumps({'digest':digest,'lastPage':last_page,'cacheVersion':1,'rows':rows}))
    starts=[]
    for index,row in enumerate(rows):
        match=META.match(row['text'])
        if not match:continue
        if not any(candidate['text'].startswith('Casting Time:') for candidate in rows[index+1:index+6]):continue
        name_start=index-1
        while name_start>0 and 11.8<=rows[name_start-1]['size']<13 and rows[name_start-1]['page']==row['page']:name_start-=1
        name=' '.join(r['text'] for r in rows[name_start:index]).title()
        starts.append((name_start,index,name,match))
    spells=[]
    for number,(start,meta_index,name,match) in enumerate(starts):
        end=starts[number+1][0] if number+1<len(starts) else len(rows)
        if edition=='5e-2014' and number+1==len(starts):
            end=next((i for i in range(meta_index+1,len(rows)) if rows[i]['text']=='Traps'),end)
        section=rows[meta_index:end]
        fields={}
        positions=[]
        for index,row in enumerate(section):
            field=re.match(r'^(Casting Time|Range|Components?|Duration):\s*(.*)',row['text'])
            if field:
                key='Components' if field.group(1)=='Component' else field.group(1)
                if key not in fields:
                    fields[key]=field.group(2);positions.append((index,key))
                    if key=='Duration':break
        if len(positions)!=4:raise ValueError(f'Incomplete metadata: {version} {name}')
        for pos,(index,key) in enumerate(positions[:-1]):fields[key]=' '.join([fields[key]]+[r['text'] for r in section[index+1:positions[pos+1][0]]])
        duration_index=positions[-1][0];body_start=duration_index+1
        level=int(match.group(1) or match.group(3) or 0)
        school=match.group(2) or match.group(4) or match.group(5)
        meta=' '.join(r['text'] for r in section[:positions[0][0]])
        classes=re.search(r'\(([^)]+)\)',meta)
        spells.append({'id':re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-'),'name':name,'level':level,'school':school.title(),'classes':[item.strip() for item in classes.group(1).split(',')] if classes and edition=='5e-2024' else [],'castingTime':fields['Casting Time'],'range':fields['Range'],'components':fields['Components'],'duration':fields['Duration'],'concentration':'concentration' in fields['Duration'].lower(),'ritual':'ritual' in fields['Casting Time'].lower() or 'ritual' in meta.lower(),'description':prose(section[body_start:]),'page':rows[start]['page']})
    # A final page boundary prevents glossary or other chapters entering the last spell.
    if len({spell['id'] for spell in spells})!=len(spells):raise ValueError('Duplicate spell identities')
    if edition=='5e-2014':
        lookup={spell['id']:spell for spell in spells};current_class=None
        for row in rows:
            if row['page']>114:break
            if row['text']=='Spell Descriptions':break
            heading=re.fullmatch(r'(Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard) Spells',row['text'])
            if heading:current_class=heading[1];continue
            key=re.sub(r'[^a-z0-9]+','-',row['text'].lower()).strip('-')
            if current_class and key in lookup and current_class not in lookup[key]['classes']:lookup[key]['classes'].append(current_class)
        missing=[spell['name'] for spell in spells if not spell['classes']]
        if missing:raise ValueError('Spells absent from source class lists: '+str(missing))
    source=f'https://media.dndbeyond.com/compendium-images/srd/{"5.2" if edition=="5e-2024" else "5.1"}/SRD_CC_v{version}.pdf'
    attribution=f'This work includes material from the System Reference Document {version} (“SRD {version}”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD {version} is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.'
    if edition=='5e-2014':attribution='This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.'
    pack={'schemaVersion':1,'edition':edition,'version':f'SRD-{version}','sourceUrl':source,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/legalcode','attribution':attribution,'modifications':'PDF line wrapping, hyphenation and heading capitalization normalized for accessible display.','spells':spells}
    out=ROOT/'public/rules'/f'srd-{version}-spells.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n')
    print(f'{edition}: {len(spells)} spells -> {out}',flush=True)

if __name__=='__main__':
    extract('5.2.1','5e-2024',175)
    extract('5.1','5e-2014',194)

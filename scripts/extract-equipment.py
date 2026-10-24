"""Build equipment catalogues directly from versioned SRD table columns.

Column bounds and page bounds are source-specific and intentionally explicit.
The extractor fails on unrecognised prices, weights or damage, rather than
silently producing apparently complete mechanics.
"""
from pathlib import Path
from collections import defaultdict
from fractions import Fraction
import importlib.util,json,re
import pdfplumber

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('srd',ROOT/'scripts/extract-srd.py')
srd=importlib.util.module_from_spec(spec);spec.loader.exec_module(srd)

def clean(text):return srd.clean(re.sub(r'(\d)([½¼¾])',r'\1 \2',text)).replace('½','1/2').replace('¼','1/4').replace('¾','3/4')
def slug(text):return re.sub('[^a-z0-9]+','-',text.lower()).strip('-')
def number(text):
    text=text.strip().replace(',','')
    if text in {'—','-',''}:return 0
    mixed=re.fullmatch(r'(\d+) (\d+/\d+)',text)
    if mixed:return float(mixed[1])+float(Fraction(mixed[2]))
    return float(Fraction(text))
def weight(text):
    text=re.sub(r'\s*lb\.?(?:\s*\(full\))?','',text,flags=re.I)
    return number(text)
def price(text):
    if text.lower()=='varies':return None
    match=re.fullmatch(r'([\d,]+(?:/\d+)?)\s*(CP|SP|EP|GP|PP)',text,re.I)
    if not match:raise ValueError('Unparsed price '+text)
    return number(match[1])*{'CP':.01,'SP':.1,'EP':.5,'GP':1,'PP':10}[match[2].upper()]
def bold_prefix(page,line):
    chars=sorted([c for c in page.chars if round(c['matrix'][5]*2)/2==line['y'] and int(c['x0']>=page.width/2)==line['column']],key=lambda c:c['x0'])
    text=''
    for char in chars:
        if 'Bold' not in char['fontname'] and char['text'].strip():break
        text+=char['text']
    return clean(text)
def rows(page,bounds,top=0,bottom=760):
    groups=defaultdict(lambda:defaultdict(list))
    for char in page.chars:
        if not top<=page.height-char['matrix'][5]<=bottom:continue
        column=next((i for i in range(len(bounds)-1) if bounds[i]<=char['x0']<bounds[i+1]),None)
        if column is not None:groups[round(char['matrix'][5]*2)/2][column].append(char)
    for y,cells in sorted(groups.items(),reverse=True):
        values=[]
        for index in range(len(bounds)-1):
            chars=sorted(cells[index],key=lambda c:c['x0']);text='';previous=None
            for char in chars:
                if previous and char['x0']-previous['x1']>max(1.5,char['size']*.22) and not text.endswith(' '):text+=' '
                text+=char['text'];previous=char
            values.append(clean(text))
        if any(values):yield values

def weapon(row,group,page,modern):
    name,damage,properties,mastery,mass,cost=row if modern else [row[0],row[2],row[4],'',row[3],row[1]]
    match=re.fullmatch(r'(\d+(?:d\d+)?)\s+(Bludgeoning|Piercing|Slashing)',damage,re.I)
    if not match and damage not in {'—','-'}:raise ValueError('Unparsed weapon damage '+str(row))
    reach=re.search(r'\(range\s+([^;)]+)',properties,re.I)
    entry={'id':slug(name),'name':name,'category':'weapon','group':group,'weight':weight(mass),'cost':cost,'costGp':price(cost),'page':page,
           'weapon':{'damage':match[1] if match else '—','damageType':match[2].lower() if match else '', 'properties':properties if properties not in {'—','-'} else '', 'range':reach[1]+' ft' if reach else '10 ft reach' if 'reach' in properties.lower() else '5 ft reach', 'ability':'finesse' if 'finesse' in properties.lower() else 'dex' if 'Ranged' in group else 'str','bonus':0},'description':f'{group}. {damage}. Properties: {properties}. '+(f'Mastery: {mastery}. ' if mastery else '')+f'Weight: {mass}. Cost: {cost}.'}
    if mastery:entry['mastery']=mastery
    return entry

def armor(row,group,page,modern):
    name,ac,strength,stealth,mass,cost=row if modern else [row[0],row[2],row[3],row[4],row[5],row[1]]
    cap=re.search(r'max\s+(\d+)',ac,re.I);strength_number=re.search(r'\d+',strength)
    return {'id':slug(name),'name':name,'category':'shield' if group.startswith('Shield') else 'armor','group':group,'weight':weight(mass),'cost':cost,'costGp':price(cost),'page':page,'armor':{'baseAC':int(re.search(r'\d+',ac)[0]),'dexCap':int(cap[1]) if cap else None if 'dex' in ac.lower() else 0,'strengthRequirement':int(strength_number[0]) if strength_number else 0,'stealthDisadvantage':'disadvantage' in stealth.lower()},'description':f'{group}. Armor Class: {ac}. Strength: {strength}. Stealth: {stealth}. Weight: {mass}. Cost: {cost}.'}

def magic_references(version):
    pages=json.loads((ROOT/'public/rules'/f'srd-{version}-reference.json').read_text())['pages']
    first=next(p['page'] for p in pages if any(h in {'Magic Items A-Z','Magic Items A–Z'} for h in p['headings']))
    last=next(p['page'] for p in pages if p['page']>first and 'Monsters' in p['headings'])
    lines=[]
    for pn in range(first,last):lines.extend(json.loads((ROOT/'.local/srd'/f'reference-{version}'/f'{pn}.json').read_text())['lines'])
    starts=[]
    for i,line in enumerate(lines[:-1]):
        if not 11.8<=line['size']<12.2:continue
        metadata=' '.join(row['text'] for row in lines[i+1:i+4])
        if re.match(r'^(?:Armor|Ammunition|Weapon|Potion|Ring|Rod|Scroll|Staff|Wand|Wondrous [Ii]tem|Shield)\b',metadata) and re.search(r'\b(?:Common|Uncommon|Rare|Legendary|Artifact|Rarity|Varies)\b',metadata,re.I):
            start=i
            while start>0 and 11.8<=lines[start-1]['size']<12.2 and lines[start-1]['page']==line['page'] and lines[start-1]['column']==line['column'] and 0<lines[start-1]['y']-lines[start]['y']<20:start-=1
            starts.append(start)
    references=[]
    for n,start in enumerate(starts):
        stop=starts[n+1] if n+1<len(starts) else len(lines)
        body=start+1;name=lines[start]['text']
        while body<stop and 11.8<=lines[body]['size']<12.2:name+=' '+lines[body]['text'];body+=1
        references.append({'id':slug(name),'name':name,'description':srd.prose(lines[body:stop]),'page':lines[start]['page'],'group':'Magic items'})
    if len({entry['id'] for entry in references})!=len(references):raise ValueError('Duplicate magic item references')
    return references

def extract(version,modern):
    pack=json.loads((ROOT/'public/rules'/f'srd-{version}-spells.json').read_text());pack.pop('spells');items=[]
    with pdfplumber.open(ROOT/'.local/srd'/f'SRD_CC_v{version}.pdf') as doc:
        page=91 if modern else 66
        bounds=[53,136,214,429,475,513,570] if modern else [57,145,190,264,301,560]
        raw=list(rows(doc.pages[page-1],bounds,top=45 if modern else 70,bottom=735 if modern else 560))
        group='Simple Melee Weapons';current=None
        for values in raw:
            heading=re.match(r'^(Simple|Martial) (Melee|Ranged)',values[0])
            if heading:group=heading[0]+' Weapons';continue
            damage=values[1 if modern else 2]
            if re.fullmatch(r'(?:\d+(?:d\d+)?\s+(?:Bludgeoning|Piercing|Slashing)|—|-)',damage,re.I):
                current={'values':values,'group':group};items.append(current)
            elif current and not values[0] and any(values):
                for index,value in enumerate(values):
                    if value:current['values'][index]+=' '+value
        items=[weapon(item['values'],item['group'],page,modern) for item in items]
        group='Light Armor'
        for page in ([92] if modern else [63,64]):
            bounds=[63,189,315,381,452,499,565] if modern else [57,440]
            for values in rows(doc.pages[page-1],bounds,top=345 if modern else 680 if page==63 else 70,bottom=715 if modern else 728 if page==63 else 300):
                joined=' '.join(values)
                heading=re.match(r'^(Light|Medium|Heavy) Armor',joined)
                if heading:group=heading[0];continue
                if re.match(r'^Shield\s*\(',joined):group='Shield';continue
                if not modern:
                    if joined=='Shield':group='Shield';continue
                    match=re.fullmatch(r'(.+?) ([\d,]+ [gsc]p) (\+?\d+(?: \+ Dex modifier(?: \(max 2\))?)?) (Str \d+|-) (Disadvantage|-) ([\d/]+ lb\.)',joined,re.I)
                    if not match:continue
                    values=list(match.groups())
                cost=values[5 if modern else 1];ac=values[1 if modern else 2]
                if re.fullmatch(r'[\d,]+\s*[GSC]P',cost,re.I) and re.match(r'\+?\d',ac):items.append(armor(values,group,page,modern))
        descriptions={};tool_values={}
        if modern:
            lines=[]
            for pn in range(93,101):
                if pn==95:continue # Full-page price table, not description prose.
                lines.extend(srd.page_lines(doc.pages[pn-1],pn-1))
            starts=[]
            for index,line in enumerate(lines):
                match=re.fullmatch(r'(.+) \(([^()]+)\)',line['text'])
                if 11.8<line['size']<12.2 and match:starts.append((index,match[1],match[2]))
            for n,(start,name,cost) in enumerate(starts):
                end=starts[n+1][0] if n+1<len(starts) else len(lines)
                for i in range(start+1,end):
                    if lines[i]['size']>13:end=i;break
                body=lines[start+1:end];description=srd.prose(body);descriptions[slug(name)]=(description,lines[start]['page'])
                if lines[start]['page']<=94 and slug(name) not in {'acid','alchemist-s-fire','ammunition'}:
                    mass=re.search(r'Weight: ([\d/]+) lb',description)
                    if mass:tool_values[slug(name)]={'id':slug(name),'name':name,'category':'tool','group':'Tools','weight':weight(mass[1]),'cost':cost,'costGp':price(cost),'page':lines[start]['page'],'description':description}
            gear_rows=[]
            for bounds in [[63,306],[313,558]]:
                gear_rows.extend(rows(doc.pages[94],bounds,top=40,bottom=735))
            for (text,) in gear_rows:
                match=re.fullmatch(r'(.+?) (\d+(?: \d+/\d+|/\d+)? lb\.?(?: \(full\))?|-|—) ([\d,]+ (?:GP|SP|CP))',text,re.I)
                if match:
                    name,mass,cost=match.groups()
                    description,pn=descriptions.get(slug(name),('',95))
                    items.append({'id':slug(name),'name':name,'category':'gear','group':'Adventuring Gear','weight':weight(mass),'cost':cost,'costGp':price(cost),'page':pn,'description':description or f'Adventuring gear. Weight: {mass}. Cost: {cost}.'})
            items.extend(tool_values.values())
            # Focus and ammunition variants have their own source tables; the
            # main price table says Varies and must not become a zero-cost item.
            for pn in [96,97]:
                for bounds in [[63,306],[313,558]]:
                    group='Ammunition' if pn==96 and bounds[0]==63 else ''
                    for (text,) in rows(doc.pages[pn-1],bounds,top=30,bottom=730):
                        if text in {'Arcane Focuses','Druidic Focuses','Holy Symbols'}:group=text
                        ammo=re.fullmatch(r'(.+?) (\d+) (Quiver|Case|Pouch) (\d+(?: \d+/\d+|/\d+)? lb\.) ([\d,]+ (?:GP|SP|CP))',text,re.I)
                        focus=re.fullmatch(r'(.+?) (\d+(?: \d+/\d+|/\d+)? lb\.|-) ([\d,]+ (?:GP|SP|CP))',text,re.I)
                        if ammo:
                            name,amount,storage,mass,cost=ammo.groups();name+=f' ({amount})'
                            note=f'A bundle of {amount} ammunition. Typical storage: {storage}; storage is purchased separately.'
                        elif focus and group in {'Arcane Focuses','Druidic Focuses','Holy Symbols'}:
                            name,mass,cost=focus.groups();parent={'Arcane Focuses':'arcane-focus','Druidic Focuses':'druidic-focus','Holy Symbols':'holy-symbol'}[group]
                            note=descriptions.get(parent,('',pn))[0] or f'{group}. See your class’s spellcasting focus rules.'
                        else:continue
                        items.append({'id':slug(name),'name':name,'category':'ammunition' if ammo else 'gear','group':group,'weight':weight(mass),'cost':cost,'costGp':price(cost),'page':pn,'description':note})
            for parent in ['gaming-set','musical-instrument']:
                note,pn=descriptions[parent]
                for match in re.finditer(r'([A-Za-z’ -]+) \(([\d,]+ (?:GP|SP|CP))(?:, ([\d/]+) lb\.)?\)',note,re.I):
                    name=match[1].strip().title();cost=match[2];mass=match[3] or '0'
                    items.append({'id':slug(name),'name':name,'category':'tool','group':parent.replace('-',' ').title(),'weight':weight(mass),'cost':cost,'costGp':price(cost),'page':pn,'description':note})
        else:
            # The 2014 price table lists explicit bundles and focus variants.
            prose_lines=[];starts=[]
            for pn in [66,67,68,70,71]:
                page=doc.pages[pn-1]
                for line in srd.page_lines(page,pn-1):
                    prefix=bold_prefix(page,line)
                    if prefix.endswith('.') and len(prefix)<70:starts.append((len(prose_lines),prefix[:-1]))
                    prose_lines.append(line)
            for i,(start,name) in enumerate(starts):
                end=starts[i+1][0] if i+1<len(starts) else len(prose_lines)
                end=next((j for j in range(start+1,end) if prose_lines[j]['size']>11),end)
                descriptions[slug(name)]=(srd.prose(prose_lines[start:end]),prose_lines[start]['page'])
            groups={'Ammunition':{'Arrows (20)','Blowgun needles (50)','Crossbow bolts (20)','Sling bullets (20)'},'Arcane focus':{'Crystal','Orb','Rod','Staff','Wand'},'Druidic focus':{'Sprig of mistletoe','Totem','Wooden staff','Yew wand'},'Holy symbol':{'Amulet','Emblem','Reliquary'}}
            for bounds in [[57,260],[328,551]]:
                for (text,) in rows(doc.pages[68],bounds,top=70,bottom=728):
                    match=re.fullmatch(r'(.+?) ([\d,]+ (?:gp|sp|cp)) (\d+(?: \d+/\d+|/\d+)? lb\.?(?: \(full\))?|-|—)',text,re.I)
                    if not match:continue
                    name,cost,mass=match.groups();group=next((key for key,choices in groups.items() if name in choices),'Adventuring Gear')
                    key=slug(re.sub(r'\s*\([^)]*\)','',name));description,pn=descriptions.get(key,('',69))
                    if not description and group!='Adventuring Gear':description,pn=descriptions.get(slug(group),('',69))
                    items.append({'id':slug(name),'name':name,'category':'ammunition' if group=='Ammunition' else 'gear','group':group,'weight':weight(mass),'cost':cost,'costGp':price(cost),'page':pn,'description':description or f'{group}. Weight: {mass}. Cost: {cost}.'})
            group='Artisan’s tools'
            for (text,) in rows(doc.pages[69],[328,551],top=130,bottom=690):
                if text in {'Gaming set','Musical instrument'}:group=text
                match=re.fullmatch(r'(.+?) ([\d,]+ (?:gp|sp|cp)) (\d+(?: \d+/\d+|/\d+)? lb\.|-)',text,re.I)
                if not match:continue
                name,cost,mass=match.groups();key=slug(name);note,pn=descriptions.get(key,descriptions.get(slug(group),('',70)))
                items.append({'id':key,'name':name,'category':'tool','group':'Tools','weight':weight(mass),'cost':cost,'costGp':price(cost),'page':pn,'description':note or f'Tool proficiency is separate for this tool. Weight: {mass}. Cost: {cost}.'})
            for start,name in starts:
                match=re.fullmatch(r'(.+ Pack) \(([\d,]+ gp)\)',name,re.I)
                if match:
                    pack_name,cost=match.groups();note,pn=descriptions[slug(name)]
                    items.append({'id':slug(pack_name),'name':pack_name,'category':'gear','group':'Equipment Packs','weight':0,'weightKnown':False,'cost':cost,'costGp':price(cost),'page':pn,'description':note})
        # Include the full source definition for each applicable weapon property.
        property_lines=[];starts=[]
        for pn in ([89,90] if modern else [64,65]):
            page=doc.pages[pn-1]
            for line in srd.page_lines(page,pn-1):
                heading=line['text'] if modern and 11.8<line['size']<12.2 else bold_prefix(page,line).removesuffix('.') if not modern else ''
                if heading and len(heading)<45:starts.append((len(property_lines),heading))
                elif line['size']>13:starts.append((len(property_lines),''))
                property_lines.append(line)
        properties={}
        for i,(start,name) in enumerate(starts):
            if not name:continue
            end=starts[i+1][0] if i+1<len(starts) else len(property_lines)
            properties[slug(name)]=srd.prose(property_lines[start+(1 if modern else 0):end])
        for item in items:
            if item['category']!='weapon':continue
            wanted=[slug(value.strip().split(' (')[0]) for value in item['weapon']['properties'].split(',')]
            if item.get('mastery'):wanted.append(slug(item['mastery']))
            if not modern and item['name'].lower() in {'lance','net'}:wanted.append(slug(item['name']))
            for key in wanted:
                if key in properties:item['description']+='\n\n'+key.replace('-',' ').title()+': '+properties[key]
        if modern:
            intro=[line for line in srd.page_lines(doc.pages[91],91) if doc.pages[91].height-line['y']<320]
            for item in items:
                if item.get('armor'):item['description']+='\n\n'+srd.prose(intro)
    if len({item['id'] for item in items})!=len(items):raise ValueError('Duplicate equipment identities')
    references=magic_references(version)
    if modern:
        for name in ['Holy Symbol','Arcane Focus','Druidic Focus','Ammunition','Gaming Set','Musical Instrument']:
            description,pn=descriptions[slug(name)];references.append({'id':slug(name),'name':name,'description':description,'page':pn,'group':'Equipment reference'})
    else:
        for name in ['Holy Symbol','Arcane Focus','Druidic Focus']:
            description,pn=descriptions[slug(name)];references.append({'id':slug(name),'name':name,'description':description,'page':pn,'group':'Equipment reference'})
    pack['modifications']='Source equipment tables parsed into named columns. Descriptions retain edition-specific source text; source page numbers retained.'
    (ROOT/'public/rules'/f'srd-{version}-equipment.json').write_text(json.dumps({**pack,'items':items,'references':references},ensure_ascii=False,indent=2)+'\n')
    print(version,len(items),'items;',sum(item['category']=='weapon' for item in items),'weapons;',sum(item['category'] in {'armor','shield'} for item in items),'armor/shields;',len(references),'additional source descriptions')

def magic_references35():
    spec=importlib.util.spec_from_file_location('srd35',ROOT/'scripts/extract-srd35.py')
    rtf=importlib.util.module_from_spec(spec);spec.loader.exec_module(rtf)
    sections={'Specific Armors':('Magic armor',''),'Specific Weapons':('Magic weapons',''),
              'Ring Descriptions':('Magic rings','Ring of '),'Rod Descriptions':('Magic rods','Rod of '),
              'Staff Descriptions':('Magic staffs','Staff of '),'Wondrous Item Descriptions':('Wondrous items',''),
              'SPECIFIC CURSED ITEMS':('Cursed items',''),'Minor Artifact Descriptions':('Minor artifacts',''),
              'Major Artifact Descriptions':('Major artifacts','')}
    references=[]
    for stem in ['MagicItemsII','MagicItemsIII','MagicItemsIV','MagicItemsV','MagicItemsVI']:
        path=rtf.HTML/(stem+'.html');body=next(rtf.Parser(path.read_text()).root.walk('body'))
        nodes=[node for node in body.children if isinstance(node,rtf.Node) and node.tag in {'p','table'} and rtf.clean(node.text())]
        blocks=rtf.blocks(path)
        if len(nodes)!=len(blocks):raise ValueError('Magic item source block alignment failed: '+stem)
        active=None;current=None
        def flush():
            nonlocal current
            if current:
                current['description']=rtf.text_blocks(current.pop('blocks'))
                if current['description']:references.append(current)
            current=None
        for node,block in zip(nodes,blocks):
            if block['type']=='paragraph' and block['size']>=12:
                flush();active=sections.get(block['text']);continue
            if not active:continue
            bold=next(node.walk('b'),None) if node.tag=='p' else None
            prefix=rtf.clean(bold.text()) if bold else ''
            name=prefix[:-1] if prefix.endswith(':') and block['text'].startswith(prefix) else None
            if name:
                flush();group,kind=active
                full_name=kind+name
                current={'id':slug(stem+'-'+full_name),'name':full_name,'group':group,'document':stem+'.rtf','blocks':[]}
            if current:current['blocks'].append({key:value for key,value in block.items() if key not in {'size','italic'}})
        flush()
    if len({entry['id'] for entry in references})!=len(references):raise ValueError('Duplicate 3.5 magic item reference')
    return references

def extract35():
    document=json.loads((ROOT/'public/rules/srd-3.5/equipment.json').read_text());blocks=document['blocks'];pack=json.loads((ROOT/'public/rules/srd-3.5-spells.json').read_text());pack.pop('spells')
    def plain(text):return re.sub('[⁰¹²³⁴⁵⁶⁷⁸⁹]','',text).replace('–','-').replace('—','-')
    def mass(text):
        text=plain(text).removeprefix('+');mixed=re.match(r'(\d+)-(\d+/\d+)',text)
        if text.lower()=='special':return 0
        if mixed:return float(mixed[1])+float(Fraction(mixed[2]))
        return weight(text)
    def cost(text):return None if text.lower()=='special' else 0 if plain(text)=='-' else price(text.removeprefix('+'))
    descriptions={};start=None;name=''
    for index,block in enumerate(blocks):
        if block['type']!='paragraph':continue
        match=re.match(r'^([A-Z][^:.!?]{0,60}): ',block['text'])
        if match:
            if start is not None:descriptions[slug(name)]='\n\n'.join(b['text'] for b in blocks[start:index] if b['type']=='paragraph' and not b['text'].isupper())
            start=index;name=match[1]
    if start is not None:descriptions[slug(name)]='\n\n'.join(b['text'] for b in blocks[start:] if b['type']=='paragraph')
    def description(name):
        key=slug(re.sub(r'\s*\([^)]*\)','',name));return descriptions.get(key,'')
    items=[];seen=set();group='Simple Weapons';handling='Unarmed Attacks'
    tables=[b['rows'] for b in blocks if b['type']=='table']
    weapons=next(t for t in tables if t[0][0]=='Table: Weapons')
    for raw in weapons[1:]:
        row=[plain(value) for value in raw]
        if row[0] in {'Simple Weapons','Martial Weapons','Exotic Weapons'}:group=row[0];continue
        if len(row)==1:
            if not row[0][:1].isdigit():handling=row[0]
            continue
        if len(row)!=8:continue
        name,price_text,small,damage,critical,reach,mass_text,damage_type=row
        key=slug(name)
        if key in seen:continue
        seen.add(key)
        if key=='net':critical='-';reach='10 ft.';mass_text='6 lb.';damage_type='-'
        ammo=damage=='-' and name!='Net'
        if ammo:mass_text=next((value for value in row if 'lb.' in value),'-')
        flags=[]
        if '⁴' in raw[0]:flags.append('Reach')
        if '⁵' in raw[0]:flags.append('Double weapon')
        if '³' in raw[3]:flags.append('Nonlethal')
        if 'Two-Handed' in handling:flags.append('Two-handed')
        note=description(name)
        item={'id':key,'name':name,'category':'ammunition' if ammo else 'weapon','group':group+' · '+handling,'weight':mass(mass_text),'weightKnown':mass_text.lower()!='special','cost':price_text,'costGp':cost(price_text),'document':'Equipment.rtf','sourceTableRow':raw,'description':note or f'{group}. {handling}. Medium damage: {damage}. Small damage: {small}. Critical: {critical}. Range increment: {reach}. Weight: {mass_text}. Cost: {price_text}.'}
        if not ammo:item['weapon']={'damage':damage,'smallDamage':small,'damageType':damage_type if damage_type!='-' else '', 'critical':critical,'properties':', '.join(flags),'range':reach if reach!='-' else 'See weapon description','ability':'dex' if handling=='Ranged Weapons' else 'str','bonus':0}
        items.append(item)
    armor_table=next(t for t in tables if t[0][0]=='Table: Armor and Shields');group='Light armor'
    for raw in armor_table[3:]:
        row=[plain(value) for value in raw]
        if len(row)!=9:continue
        if row[0] in {'Light armor','Medium armor','Heavy armor','Shields','Extras'}:group=row[0];continue
        if not row[1]:continue
        name,price_text,bonus,cap,penalty,failure,speed30,speed20,mass_text=row
        item={'id':slug(name),'name':name,'category':'shield' if group=='Shields' else 'gear' if group=='Extras' else 'armor','group':group,'weight':mass(mass_text),'cost':price_text,'costGp':cost(price_text),'document':'Equipment.rtf','sourceTableRow':raw,'description':description(name) or f'{group}. Armor/shield bonus: {bonus}. Maximum Dexterity bonus: {cap}. Armor check penalty: {penalty}. Arcane spell failure: {failure}. Speed (30 / 20): {speed30} / {speed20}.'}
        if group!='Extras':item['armor']={'baseAC':int(bonus),'dexCap':None if cap=='-' else int(cap),'strengthRequirement':0,'stealthDisadvantage':False,'checkPenalty':int(penalty),'arcaneFailure':int(failure.removesuffix('%')),'speed30':None if speed30=='-' else int(speed30.split(' ')[0]),'speed20':None if speed20=='-' else int(speed20.split(' ')[0])}
        items.append(item);seen.add(item['id'])
    goods=next(t for t in tables if t[0][0]=='Table: Goods and Services');group='Adventuring Gear'
    for row in goods[1:]:
        if len(row)!=3:continue
        name,price_text,mass_text=row
        if not price_text and not mass_text:group=name;continue
        if name=='Item' or not price_text or group not in {'Adventuring Gear','Special Substances and Items','Tools and Skill Kits','Clothing'}:continue
        if not re.fullmatch(r'[\d,]+ (?:gp|sp|cp)|—',price_text):continue
        if name in {'Very simple','Average','Good','Amazing'}:name='Lock, '+name.lower()
        key=slug(name)
        if key in seen:raise ValueError('Duplicate equipment '+key)
        seen.add(key)
        items.append({'id':key,'name':name,'category':'tool' if group=='Tools and Skill Kits' else 'gear','group':group,'weight':mass(mass_text),'cost':price_text,'costGp':cost(price_text),'document':'Equipment.rtf','sourceTableRow':row,'description':description(name) or f'{group}. Weight: {mass_text}. Cost: {price_text}.'})
    pack['modifications']='Original RTF equipment tables converted into named fields; superscript footnote markers retained in original rows and removed from numeric mechanics. The malformed Net and repeating-crossbow ammunition cells are aligned by their explicit range/weight units. Medium-size values are the catalogue default.'
    references=magic_references35()
    (ROOT/'public/rules/srd-3.5-equipment.json').write_text(json.dumps({**pack,'items':items,'references':references},ensure_ascii=False,indent=2)+'\n')
    print('3.5',len(items),'items;',sum(i['category']=='weapon' for i in items),'weapons;',sum(i['category'] in {'armor','shield'} for i in items),'armor/shields;',len(references),'additional source descriptions')

if __name__=='__main__':
    extract('5.2.1',True)
    extract('5.1',False)
    extract35()

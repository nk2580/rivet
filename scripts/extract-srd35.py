"""Extract archived original 3.5 SRD RTF sources via textutil's local HTML export.

The archive is data, never executable code or agent instructions. HTML is parsed
with Python's standard library and never rendered as active page markup.
"""
from dataclasses import dataclass,field
from html.parser import HTMLParser
from pathlib import Path
import hashlib,json,re

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'.local/srd35/source'
HTML=ROOT/'.local/srd35/html'
OUT=ROOT/'public/rules/srd-3.5'
ARCHIVE='https://web.archive.org/web/20160328013113id_/http://www.wizards.com/d20/files/v35/SRD.zip'
OFFICIAL='https://web.archive.org/web/20100201014038/http://www.wizards.com/default.asp?x=d20/article/srd35'

@dataclass
class Node:
    tag:str
    attrs:dict=field(default_factory=dict)
    children:list=field(default_factory=list)
    def text(self):
        if self.tag=='br':return '\n'
        text=''.join(child.text() if isinstance(child,Node) else child for child in self.children)
        return text.translate(str.maketrans('0123456789','⁰¹²³⁴⁵⁶⁷⁸⁹')) if self.tag=='sup' else text
    def walk(self,tag):
        for child in self.children:
            if isinstance(child,Node):
                if child.tag==tag:yield child
                yield from child.walk(tag)

class Parser(HTMLParser):
    def __init__(self,content):
        super().__init__(convert_charrefs=True);self.root=Node('root');self.stack=[self.root];self.feed(content)
    def handle_starttag(self,tag,attrs):
        node=Node(tag,dict(attrs));self.stack[-1].children.append(node)
        if tag not in {'br','hr','meta','link','img','input'}:self.stack.append(node)
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag==tag:self.stack=self.stack[:i];break
    def handle_data(self,text):self.stack[-1].children.append(text)

def clean(text):return re.sub(r'\s+',' ',text).strip()
def slug(text):return re.sub('[^a-z0-9]+','-',text.lower()).strip('-')
def blocks(path):
    content=path.read_text();parser=Parser(content)
    sizes={key:float(size) for key,size in re.findall(r'p\.([\w-]+)\s*\{[^}]*font:\s*([\d.]+)px',content)}
    body=next(parser.root.walk('body'));result=[]
    for node in body.children:
        if not isinstance(node,Node):continue
        if node.tag=='p':
            text=clean(node.text())
            if text:result.append({'type':'paragraph','text':text,'size':sizes.get(node.attrs.get('class'),10),'italic':[clean(span.text()) for span in node.walk('i')]})
        elif node.tag=='table':
            rows=[]
            for row in node.walk('tr'):
                cells=[clean(cell.text()) for cell in row.children if isinstance(cell,Node) and cell.tag in {'td','th'}]
                if cells:rows.append(cells)
            if rows:result.append({'type':'table','rows':rows})
    return result

def text_blocks(values):return '\n\n'.join(block['text'] if block['type']=='paragraph' else '\n'.join(' | '.join(row) for row in block['rows']) for block in values)
SCHOOL=re.compile(r'^(?:Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation|Universal)\b',re.I)
LABEL=re.compile(r'^(Level|Components?|Casting Time|Range|Targets?|Target, Effect, or Area|Target or Area|Target or Targets|Area or Target|Target/Effect|Effect|Area|Duration|Saving Throw|Spell Resistance|XP Cost):\s*(.*)',re.I)
CLASS={'Brd':'bard','Clr':'cleric','Drd':'druid','Pal':'paladin','Rgr':'ranger','Sor':'sorcerer','Wiz':'wizard','Adept':'adept','Assassin':'assassin','Blackguard':'blackguard'}

def spells_in(document,filename):
    starts=[]
    for index,block in enumerate(document):
        if block['type']!='paragraph' or not 11.5<=block['size']<=12.5:continue
        tail=document[index+1:index+5]
        if tail and tail[0]['type']=='paragraph' and SCHOOL.match(tail[0]['text']) and any(part['type']=='paragraph' and part['text'].startswith('Level:') for part in tail):starts.append(index)
    entries=[]
    for number,start in enumerate(starts):
        end=starts[number+1] if number+1<len(starts) else len(document)
        name=document[start]['text'];school=document[start+1]['text'];metadata={};body=start+2
        while body<end and document[body]['type']=='paragraph':
            match=LABEL.match(document[body]['text'])
            if not match:
                # Two literal typographical/line-wrap defects in the original
                # RTF. Preserve the value while joining only the known defect.
                text=document[body]['text']
                if text=='Effect Magical sensor':metadata['Effect']='Magical sensor';body+=1;continue
                if name=='Magic Aura' and text=='to 5 lb./level':metadata['Target']+=' '+text;body+=1;continue
                break
            key=match.group(1).title()
            metadata['Components' if key=='Component' else key]=match.group(2);body+=1
        levels={}
        for choice in metadata.get('Level','').split(','):
            match=re.fullmatch(r'\s*([A-Za-z/ ]+)\s+(\d)\s*',choice)
            if not match:raise ValueError(f'Unparsed class level: {filename} {name}: {choice}')
            for key in match.group(1).split('/'):
                key=key.strip();levels[CLASS.get(key,'domain:'+slug(key))]=int(match.group(2))
        if not levels:raise ValueError(f'Missing spell levels: {name}')
        own=document[body:end];inherited_name=None
        for block in own[:3]:
            if block['type']!='paragraph':continue
            relation=re.search(r'(?:functions|works)\s+(?:(?:just\s+)?like|similarly to)\s+(.+)',block['text'],re.I)
            if relation:inherited_name=relation.group(1);break
        entries.append({'id':slug(name),'name':name,'level':min(levels.values()),'school':school,'classes':[key for key in levels if not key.startswith('domain:')],'classLevels':levels,'castingTime':metadata.get('Casting Time',''),'range':metadata.get('Range',''),'components':metadata.get('Components',''),'duration':metadata.get('Duration',''),'concentration':metadata.get('Duration','').lower().startswith('concentration'),'ritual':False,'description':text_blocks(own),'blocks':own,'document':filename,'sourceUrl':ARCHIVE,'metadata':metadata,'inheritedName':inherited_name,'aliases':[]})
    return entries

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    manifest=[];spells=[];legal=''
    for path in sorted(HTML.glob('*.html')):
        document=blocks(path);filename=path.stem+'.rtf';raw=SOURCE/filename
        digest=hashlib.sha256(raw.read_bytes()).hexdigest();key=slug(path.stem)
        title=next((block['text'] for block in document if block['type']=='paragraph' and block['size']>=16),path.stem)
        manifest.append({'id':key,'title':title,'document':filename,'sha256':digest,'path':f'/rules/srd-3.5/{key}.json'})
        public_blocks=[{key:value for key,value in block.items() if key not in {'size','italic'}} for block in document]
        (OUT/f'{key}.json').write_text(json.dumps({'schemaVersion':1,'edition':'3.5e','version':'SRD-3.5','id':key,'title':title,'document':filename,'sourceUrl':ARCHIVE,'sourceSha256':digest,'license':'OGL-1.0a','blocks':public_blocks},ensure_ascii=False,indent=2)+'\n')
        if path.stem.startswith('Spells'):spells.extend(spells_in(document,filename))
        if path.stem=='Legal':legal=text_blocks(document)
    if len({spell['id'] for spell in spells})!=len(spells):raise ValueError('Duplicate spell IDs')
    def name_key(name):return re.sub('[^a-z0-9]+',' ',name.lower()).strip()
    lookup={}
    for spell in spells:
        names=[spell['name']]
        if ', ' in spell['name']:
            base,modifier=spell['name'].rsplit(', ',1);names.append(modifier+' '+base)
        spell['aliases']=names[1:]
        for name in names:lookup[name_key(name)]=spell
    # Longest explicit source name wins, including source prose that puts Mass,
    # Lesser and Greater before rather than after the base name.
    names=sorted(lookup,key=len,reverse=True)
    unresolved=[]
    def resolve(spell,chain=()):
        if spell['id'] in chain:raise ValueError('Spell inheritance cycle')
        if spell.get('resolved'):return
        name=spell['inheritedName'];key=name_key(name) if name else ''
        key=re.sub(r'^(?:a|an|the) ','',key)
        base=next((lookup[candidate] for candidate in names if key==candidate or key.startswith(candidate+' ')),None)
        if base:
            resolve(base,chain+(spell['id'],))
            for key in ['castingTime','range','components','duration']:
                if not spell[key]:spell[key]=base[key]
            spell['concentration']=spell['duration'].lower().startswith('concentration')
            spell['baseSpellId']=base['id']
        for key in ['castingTime','range','components','duration']:
            if not spell[key]:unresolved.append({'spell':spell['name'],'field':key,'inheritedName':name})
        spell['resolved']=True
    for spell in spells:resolve(spell)
    for spell in spells:
        spell.pop('resolved',None);spell.pop('inheritedName',None)
        for block in spell['blocks']:
            block.pop('size',None);block.pop('italic',None)
    archive_digest=hashlib.sha256((ROOT/'.local/srd35/SRD.zip').read_bytes()).hexdigest()
    header={'schemaVersion':1,'edition':'3.5e','version':'SRD-3.5','sourceUrl':ARCHIVE,'sourcePage':OFFICIAL,'sourceSha256':archive_digest,'license':'OGL-1.0a','licenseUrl':'/rules/OGL-1.0a.txt','attribution':'System Reference Document Copyright 2000–2003, Wizards of the Coast, Inc. See the included Open Game License and Section 15 copyright notice.','modifications':'RTF converted to structured text and tables; missing variant casting metadata linked to the explicitly referenced base spell.'}
    (ROOT/'public/rules/srd-3.5-spells.json').write_text(json.dumps({**header,'spells':spells},ensure_ascii=False,indent=2)+'\n')
    (OUT/'manifest.json').write_text(json.dumps({**header,'documents':manifest},ensure_ascii=False,indent=2)+'\n')
    (ROOT/'public/rules/OGL-1.0a.txt').write_text(legal+'\n')
    (ROOT/'.local/srd35/unresolved-spell-metadata.json').write_text(json.dumps(unresolved,indent=2)+'\n')
    print(f'{len(manifest)} source documents; {len(spells)} spells; {len(unresolved)} metadata fields need review.',flush=True)

if __name__=='__main__':main()

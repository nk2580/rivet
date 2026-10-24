"""Index complete licensed source documents for offline reference and retrieval.

Search text is a locator, not a replacement for the original PDF's tables. The
unmodified CC PDFs are included alongside their source hashes for exact reading.
"""
from pathlib import Path
import importlib.util,json,shutil
import pdfplumber

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('srd',ROOT/'scripts/extract-srd.py');srd=importlib.util.module_from_spec(spec);spec.loader.exec_module(srd)

def extract(version):
    header=json.loads((ROOT/'public/rules'/f'srd-{version}-spells.json').read_text());header.pop('spells')
    source=ROOT/'.local/srd'/f'SRD_CC_v{version}.pdf'
    cache=ROOT/'.local/srd'/f'reference-{version}';cache.mkdir(parents=True,exist_ok=True)
    pages=[];section='Introduction'
    with pdfplumber.open(source) as pdf:
        for index,page in enumerate(pdf.pages):
            path=cache/f'{index+1}.json'
            cached=json.loads(path.read_text()) if path.exists() else None
            if cached and cached.get('sourceHash')==header['sourceSha256']:lines=cached['lines']
            else:
                lines=srd.page_lines(page,index)
                path.write_text(json.dumps({'sourceHash':header['sourceSha256'],'lines':lines}))
            headings=[line['text'] for line in lines if line['size']>=11.8]
            major=[line['text'] for line in lines if line['size']>=17]
            if major:section=major[0]
            pages.append({'id':f'page-{index+1}','page':index+1,'title':section,'headings':headings,'text':'\n'.join(line['text'] for line in lines)})
            page.close()
            if (index+1)%50==0:print(version,index+1,'pages indexed',flush=True)
    filename=f'SRD_CC_v{version}.pdf';shutil.copyfile(source,ROOT/'public/rules'/filename)
    output=ROOT/'public/rules'/f'srd-{version}-reference.json'
    output.write_text(json.dumps({**header,'pdfPath':f'/rules/{filename}','modifications':'Unmodified licensed source PDF; text and headings indexed by source page for offline search. PDF remains the exact source for layout and tables.','pages':pages},ensure_ascii=False,indent=2)+'\n')
    print(version,len(pages),'source pages;',output.stat().st_size,'index bytes',flush=True)

def extract35():
    root=ROOT/'public/rules/srd-3.5';header=json.loads((root/'manifest.json').read_text());documents=header.pop('documents');pages=[]
    header['modifications']='Complete archived RTF sources converted to structured text and tables; superscript footnote markers retained. Text indexed by original source document for offline search.'
    for entry in documents:
        document=json.loads((root/(entry['id']+'.json')).read_text());blocks=document['blocks']
        text='\n'.join(block['text'] if block['type']=='paragraph' else '\n'.join(' | '.join(row) for row in block['rows']) for block in blocks)
        pages.append({'id':entry['id'],'title':entry['title'],'headings':[],'text':text,'documentPath':entry['path'],'document':entry['document'],'sourceSha256':entry['sha256']})
    output=ROOT/'public/rules/srd-3.5-reference.json';output.write_text(json.dumps({**header,'pages':pages},ensure_ascii=False,indent=2)+'\n')
    print('3.5',len(pages),'source documents;',output.stat().st_size,'index bytes',flush=True)

if __name__=='__main__':
    extract('5.2.1');extract('5.1');extract35()

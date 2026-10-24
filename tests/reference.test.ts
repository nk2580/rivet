import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { referencePackSchema,searchReference } from '../src/rules/reference';
describe('complete licensed offline source library',()=>{
  it('indexes all original fifth edition pages and includes the unmodified matching source PDFs',async()=>{
    for(const [version,edition,count] of [['5.1','5e-2014',403],['5.2.1','5e-2024',364]] as const){
      const pack=referencePackSchema.parse(JSON.parse(await readFile(`public/rules/srd-${version}-reference.json`,'utf8')));
      expect(pack.edition).toBe(edition);expect(pack.pages).toHaveLength(count);expect(pack.pages.map(p=>p.page)).toEqual(Array.from({length:count},(_,i)=>i+1));
      const pdf=await readFile('public'+pack.pdfPath);expect(createHash('sha256').update(pdf).digest('hex')).toBe(pack.sourceSha256);
      expect(searchReference(pack,'Extra Attack').length).toBeGreaterThan(0);expect(searchReference(pack,'Aura of Protection').length).toBeGreaterThan(0);
      expect(pack.pages.some(page=>page.text.includes('Multiclassing'))).toBe(true);
      expect(searchReference(pack,'zzzz-no-such-source-term')).toEqual([]);
    }
  });
  it('binds all 86 archived 3.5e documents to their original source hashes and preserves tables',async()=>{
    const pack=referencePackSchema.parse(JSON.parse(await readFile('public/rules/srd-3.5-reference.json','utf8')));
    expect(pack.pages).toHaveLength(86);expect(pack.license).toBe('OGL-1.0a');
    for(const entry of pack.pages){
      const document=JSON.parse(await readFile('public'+entry.documentPath,'utf8'));expect(document.id).toBe(entry.id);expect(document.sourceSha256).toBe(entry.sourceSha256);expect(document.blocks.length).toBeGreaterThan(0);
    }
    expect(searchReference(pack,'Power Attack').some(entry=>entry.document==='Feats.rtf')).toBe(true);
    const equipment=JSON.parse(await readFile('public/rules/srd-3.5/equipment.json','utf8'));
    expect(equipment.blocks.some((block:{type:string;rows?:string[][]})=>block.type==='table'&&block.rows?.[0][0]==='Table: Armor and Shields')).toBe(true);
  });
});

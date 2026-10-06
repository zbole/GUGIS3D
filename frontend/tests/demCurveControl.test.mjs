import test from 'node:test';
import assert from 'node:assert/strict';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {act,create} from 'react-test-renderer';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/dem-curve-control.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/DemCurvedGridControl.tsx')),out);
const {default:Control}=await import(pathToFileURL(out).href),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
test('real-DTM controls preserve all 20 sites and never present an unavailable or adverse result as an advantage',()=>{
  let r;act(()=>r=create(React.createElement(Control)));
  try{assert.match(text(r.toJSON()),/56 \/ 60/);assert.match(text(r.toJSON()),/其中 0 个获得更低 E₂/);
    assert.match(text(r.toJSON()),/序列化精度是本控制的一个限制/);assert.match(text(r.toJSON()),/不是论文作者的软件或 ArcGIS 实测/);
    for(const target of [.1,.25,.5]){
      act(()=>r.root.findByProps({'aria-label':'真实DTM面带控制误差目标'}).props.onChange({target:{value:String(target)}}));
      const rows=r.root.findByType('tbody').findAllByType('tr');assert.equal(rows.length,20);
      for(const row of rows){const tds=row.findAllByType('td'),ratio=text(tds[1]);assert.ok(ratio==='—'||Number(ratio)>1);}
      assert.equal(rows.filter(row=>text(row).includes('无适配候选')).length,target===.1?0:target===.25?1:3);
    }
  }finally{act(()=>r.unmount());}
});
test('every displayed native model and download exists in the publication',async()=>{
  const report=JSON.parse(await readFile(f('../../shared/dem-curved-grid-control-v1.json')));
  for(const c of report.cases)for(const p of c.pairs){assert.equal((await readFile(f(`../public/research/dem-curved-grid-v1/${c.id}/${p.baseline.filename}`))).length,p.baseline.bytes);
    if(p.selected)assert.equal((await readFile(f(`../public/research/dem-curved-grid-v1/${c.id}/${p.selected.id}.json`))).length,p.selected.bytes);}
});

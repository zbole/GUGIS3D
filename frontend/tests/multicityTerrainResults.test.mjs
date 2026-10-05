import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {create,act} from 'react-test-renderer';
const url=p=>new URL(p,import.meta.url);
const output=fileURLToPath(url('../node_modules/.cache/gugis-tests/multicity-results.mjs'));
await build({entryPoints:[fileURLToPath(url('../src/compare/PaperTerrainResults.tsx'))],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const {RealTerrainResultSummary:Card}=await import(pathToFileURL(output).href);
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
test('scope, site and target update paired results without hiding disadvantages',()=>{
  let r;act(()=>r=create(React.createElement(Card)));
  const change=(name,value)=>act(()=>r.root.findByProps({'aria-label':name}).props.onChange({target:{value}}));
  act(()=>r.root.findAllByType('button').find(b=>text(b)==='新增跨城 · 6 个样区').props.onClick());
  assert.match(text(r.toJSON()),/小 29\.9%/);assert.match(text(r.toJSON()),/大 17\.4%/);
  assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,6);
  assert.match(text(r.toJSON()),/此档未使用直纹面/);assert.match(text(r.toJSON()),/ArcGIS 软件运行：待完成/);
  change('跨城对标样区','york-north-quarter');change('真实地形结果误差目标','.5');
  assert.match(text(r.toJSON()),/小 42\.9%/);assert.match(text(r.toJSON()),/11\.03214 \/ 9\.06784/);
  assert.equal(r.root.findAllByType('img')[0].props.src,'/research/multicity-terrain/york-north-quarter-error-cost.png');
  const link=r.root.findAllByType('a').find(a=>text(a)==='当前三角模型逐点 CSV ↓');
  assert.equal(link.props.href,'/research/multicity-terrain/york-north-quarter/local_triangles-0.5m.queries.csv');
  act(()=>r.root.findAllByType('button').find(b=>text(b)==='布里斯托原始样区').props.onClick());
  assert.equal(r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.5);
  assert.match(text(r.toJSON()),/大 2\.0%/);
  act(()=>r.unmount());
});
test('explicit cross-city deep link opens the scope and registers only a reversible listener',()=>{
  const prior=globalThis.window;const listeners=new Map();let r;
  try{globalThis.window={location:{hash:'#multicity-terrain-results'},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    act(()=>r=create(React.createElement(Card)));assert.equal(r.root.findAllByType('button').find(b=>text(b)==='新增跨城 · 6 个样区').props['aria-pressed'],true);
    assert.equal(listeners.size,1);act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});
test('every query model is covered, no target or site is omitted from the public summary',async()=>{
  const summary=JSON.parse(await readFile(url('../../shared/multicity-terrain-benchmark.json')));
  const audit=JSON.parse(await readFile(url('../public/research/multicity-terrain/native-query-audit.json')));
  assert.equal(audit.rows.length,36);
  for(const c of summary.cases)for(const m of c.models){const a=audit.rows.find(a=>a.case_id===c.id&&a.family===m.family&&a.target_m===m.target_m);assert.equal(a.model_sha256,m.sha256);assert.equal(a.requested,a.hits);assert.ok(a.sampled_max_absolute_m<=m.continuous_bound_m+1e-8);assert.ok(a.max_control_error_m<1e-9);}
});

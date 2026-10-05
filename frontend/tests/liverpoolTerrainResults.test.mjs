import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {terrainIndex} from '../src/studio/terrainMath.ts';
const url=p=>new URL(p,import.meta.url);
const output=fileURLToPath(url('../node_modules/.cache/gugis-tests/liverpool-results.mjs'));
await build({entryPoints:[fileURLToPath(url('../src/compare/PaperTerrainResults.tsx'))],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const {RealTerrainResultSummary:Card}=await import(pathToFileURL(output).href);
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
test('all twelve Liverpool saved functions reproduce the fixed native query audit and retain every control',async()=>{
  const report=JSON.parse(await readFile(url('../../shared/liverpool-terrain-benchmark.json')));
  const audit=JSON.parse(await readFile(url('../public/research/liverpool-terrain-benchmark/native-query-audit.json')));
  assert.equal(audit.rows.length,12);
  for(const c of report.cases){
    const folder=`../public/research/liverpool-terrain-benchmark/${c.id}/`;
    const fixture=JSON.parse(await readFile(url(folder+'query-fixture.json')));
    for(const m of c.models){
      const model=JSON.parse(await readFile(url(folder+m.filename))),index=terrainIndex(model);
      const row=audit.rows.find(a=>a.case_id===c.id&&a.family===m.family&&a.target_m===m.target_m);
      assert.equal(row.model_sha256,m.sha256);assert.equal(row.fixture_sha256,c.fixture_sha256);
      const errors=fixture.xy.map(([x,y],i)=>{const q=index.query(x,y);assert.ok(q);return q.height-fixture.reference[i];});
      assert.equal(errors.length,4096);
      assert.ok(Math.abs(Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/4096)-row.sampled_rmse_m)<1e-12);
      assert.ok(Math.max(...errors.map(Math.abs))<=m.continuous_bound_m+1e-8);
      for(const [x,y,z] of model.points){const q=index.query(x,y);assert.ok(q);assert.ok(Math.abs(q.height-z)<1e-9);}
    }
  }
});



test('Liverpool shows the paired file benefit, every inferior mixed result and actual functions',()=>{
  let r;act(()=>r=create(React.createElement(Card)));
  const choose=(name,value)=>act(()=>r.root.findByProps({'aria-label':name}).props.onChange({target:{value}}));
  act(()=>r.root.findAllByType('button').find(b=>text(b)==='利物浦 · 2 个样区').props.onClick());
  assert.match(text(r.toJSON()),/小 28\.0%/);assert.match(text(r.toJSON()),/大 9\.5%/);
  assert.match(text(r.toJSON()),/1\.24829 \/ 1\.12683/);assert.match(text(r.toJSON()),/直纹四边形 53/);
  assert.match(text(r.toJSON()),/本档原生三角带在文件体积与全域 E₂ 上同时不劣/);
  assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,2);
  choose('跨城对标样区','liverpool-north-quarter');choose('真实地形结果误差目标','.5');
  assert.match(text(r.toJSON()),/小 27\.8%/);assert.match(text(r.toJSON()),/大 12\.1%/);
  assert.match(text(r.toJSON()),/6\.20881 \/ 5\.49931/);assert.match(text(r.toJSON()),/此档未使用直纹面/);
  assert.match(text(r.toJSON()),/131 个实际直纹四边形；6 档文件更大/);
  assert.match(text(r.toJSON()),/ArcGIS 软件运行：待完成/);
  assert.equal(r.root.findAllByType('img')[0].props.src,'/research/liverpool-terrain-benchmark/liverpool-north-quarter-error-cost.png');
  for(const link of r.root.findAllByType('a'))assert.ok(link.props.href.startsWith('/research/liverpool-terrain-benchmark/'));
  act(()=>r.unmount());
});

test('Liverpool results deep link restores its exact site and target without initializing a scene',()=>{
  const prior=globalThis.window;let r;const listeners=new Map();
  try{
    globalThis.window={location:new URL('http://localhost/compare?terrain_scope=liverpool&terrain_site=liverpool-north-quarter&terrain_target=0.25#liverpool-terrain-results'),addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
    act(()=>r=create(React.createElement(Card)));
    assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'liverpool-north-quarter');
    assert.equal(r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.25);
    assert.match(text(r.toJSON()),/大 16\.5%/);
    assert.equal(r.root.findAllByType('canvas').length,0);
    window.location=new URL('http://localhost/compare?terrain_target=0.5#cambridge-terrain-results');act(()=>listeners.get('popstate')());
    assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'cambridge-centre');
    assert.equal(r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.5);
    act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

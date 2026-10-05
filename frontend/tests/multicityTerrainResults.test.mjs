import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {terrainIndex} from '../src/studio/terrainMath.ts';
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
    assert.equal(listeners.size,2);act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});
test('every query model is covered, no target or site is omitted from the public summary',async()=>{
  const summary=JSON.parse(await readFile(url('../../shared/multicity-terrain-benchmark.json')));
  const audit=JSON.parse(await readFile(url('../public/research/multicity-terrain/native-query-audit.json')));
  assert.equal(audit.rows.length,36);
  for(const c of summary.cases)for(const m of c.models){const a=audit.rows.find(a=>a.case_id===c.id&&a.family===m.family&&a.target_m===m.target_m);assert.equal(a.model_sha256,m.sha256);assert.equal(a.requested,a.hits);assert.ok(a.sampled_max_absolute_m<=m.continuous_bound_m+1e-8);assert.ok(a.max_control_error_m<1e-9);}
});

test('Oxford scope preserves opposing outcomes and actual ruled counts, with isolated downloads and shared target',()=>{
  let r;act(()=>r=create(React.createElement(Card)));
  const button=name=>r.root.findAllByType('button').find(b=>text(b)===name);
  const change=(name,value)=>act(()=>r.root.findByProps({'aria-label':name}).props.onChange({target:{value}}));
  act(()=>button('牛津 · 2 个样区').props.onClick());
  assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,2);
  assert.match(text(r.toJSON()),/小 4\.6%/);assert.match(text(r.toJSON()),/1\.58927 \/ 1\.51509/);
  assert.match(text(r.toJSON()),/直纹四边形 17/);assert.match(text(r.toJSON()),/共 49,152/);
  change('跨城对标样区','oxford-north-quarter');change('真实地形结果误差目标','.25');
  assert.match(text(r.toJSON()),/大 108\.9%/);assert.match(text(r.toJSON()),/4\.42181 \/ 3\.77474/);
  assert.match(text(r.toJSON()),/此档未使用直纹面/);
  assert.equal(r.root.findAllByType('img')[0].props.src,'/research/oxford-terrain-benchmark/oxford-north-quarter-error-cost.png');
  for(const link of r.root.findAllByType('a'))assert.ok(link.props.href.startsWith('/research/oxford-terrain-benchmark/'));
  act(()=>button('新增跨城 · 6 个样区').props.onClick());
  assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'manchester-centre');
  assert.equal(r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.25);
  act(()=>button('牛津 · 2 个样区').props.onClick());
  assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'oxford-centre');
  act(()=>r.unmount());
});

test('Oxford deep link and reversible hash listener activate independently of the historical six sites',()=>{
  const prior=globalThis.window;const listeners=new Map();let r;
  try{globalThis.window={location:{hash:'#oxford-terrain-results'},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    act(()=>r=create(React.createElement(Card)));
    assert.equal(r.root.findAllByType('button').find(b=>text(b)==='牛津 · 2 个样区').props['aria-pressed'],true);
    globalThis.window.location.hash='#multicity-terrain-results';act(()=>listeners.get('hashchange')());
    assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,6);
    act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

test('all twelve Oxford saved functions reproduce the fixed native query audit and retain every control',async()=>{
  const report=JSON.parse(await readFile(url('../../shared/oxford-terrain-benchmark.json')));
  const audit=JSON.parse(await readFile(url('../public/research/oxford-terrain-benchmark/native-query-audit.json')));
  assert.equal(audit.rows.length,12);
  for(const c of report.cases){
    const folder=`../public/research/oxford-terrain-benchmark/${c.id}/`;
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

test('all twelve Cambridge saved functions reproduce the fixed native query audit and retain every control',async()=>{
  const report=JSON.parse(await readFile(url('../../shared/cambridge-terrain-benchmark.json')));
  const audit=JSON.parse(await readFile(url('../public/research/cambridge-terrain-benchmark/native-query-audit.json')));
  assert.equal(audit.rows.length,12);
  for(const c of report.cases){
    const folder=`../public/research/cambridge-terrain-benchmark/${c.id}/`;
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


test('Cambridge uses the current source, exposes tradeoffs and inferior results, and isolates site state',()=>{
  let r;act(()=>r=create(React.createElement(Card)));
  const button=name=>r.root.findAllByType('button').find(b=>text(b)===name);
  const change=(name,value)=>act(()=>r.root.findByProps({'aria-label':name}).props.onChange({target:{value}}));
  act(()=>button('剑桥 · 2 个样区').props.onClick());
  assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,2);
  assert.match(text(r.toJSON()),/大 35\.3%/);assert.match(text(r.toJSON()),/1\.71306 \/ 1\.78431/);
  assert.match(text(r.toJSON()),/直纹四边形 1/);assert.match(text(r.toJSON()),/本档存在精度与体积取舍/);
  change('真实地形结果误差目标','.5');
  assert.match(text(r.toJSON()),/大 95\.9%/);assert.match(text(r.toJSON()),/10\.46800 \/ 7\.89349/);
  assert.match(text(r.toJSON()),/本档原生三角带在文件体积与全域 E₂ 上同时不劣/);
  assert.match(text(r.toJSON()),/此档未使用直纹面/);
  change('跨城对标样区','cambridge-north-quarter');change('真实地形结果误差目标','.25');
  assert.match(text(r.toJSON()),/4\.24548 \/ 4\.52666/);assert.match(text(r.toJSON()),/大 34\.2%/);
  assert.equal(r.root.findAllByType('img')[0].props.src,'/research/cambridge-terrain-benchmark/cambridge-north-quarter-error-cost.png');
  for(const link of r.root.findAllByType('a'))assert.ok(link.props.href.startsWith('/research/cambridge-terrain-benchmark/'));
  act(()=>button('牛津 · 2 个样区').props.onClick());
  assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'oxford-centre');
  act(()=>button('剑桥 · 2 个样区').props.onClick());
  assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'cambridge-centre');
  assert.equal(r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.25);
  act(()=>r.unmount());
});

test('Cambridge deep link and hash changes retain the scope without loading any 3D view',()=>{
  const prior=globalThis.window;const listeners=new Map();let r;
  try{globalThis.window={location:{hash:'#cambridge-terrain-results'},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    act(()=>r=create(React.createElement(Card)));
    assert.equal(r.root.findAllByType('button').find(b=>text(b)==='剑桥 · 2 个样区').props['aria-pressed'],true);
    globalThis.window.location.hash='#oxford-terrain-results';act(()=>listeners.get('hashchange')());
    assert.equal(r.root.findAllByType('button').find(b=>text(b)==='牛津 · 2 个样区').props['aria-pressed'],true);
    globalThis.window.location.hash='#cambridge-terrain-results';act(()=>listeners.get('hashchange')());
    assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'cambridge-centre');
    act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});


test('recorded result URL survives remount and same-scope browser navigation, preserving workspace options',()=>{
  const prior=globalThis.window;const listeners=new Map();let r;
  const initial=new URL('http://127.0.0.1:5173/compare?city=london&cities=london,bristol&tile_profile=economy#paper-results');
  const marker={preserve:true};const writes=[];
  try{
    globalThis.window={location:initial,history:{state:marker,replaceState:(state,unused,href)=>{assert.equal(state,marker);writes.push(href);globalThis.window.location=new URL(href);}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    act(()=>r=create(React.createElement(Card)));
    act(()=>r.root.findAllByType('button').find(b=>text(b)==='剑桥 · 2 个样区').props.onClick());
    act(()=>r.root.findByProps({'aria-label':'跨城对标样区'}).props.onChange({target:{value:'cambridge-north-quarter'}}));
    act(()=>r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.onChange({target:{value:'.25'}}));
    const saved=new URL(writes.at(-1));
    assert.equal(saved.hash,'#cambridge-terrain-results');assert.equal(saved.searchParams.get('terrain_site'),'cambridge-north-quarter');
    assert.equal(saved.searchParams.get('terrain_target'),'0.25');assert.equal(saved.searchParams.get('city'),'london');assert.equal(saved.searchParams.get('tile_profile'),'economy');
    act(()=>r.unmount());act(()=>r=create(React.createElement(Card)));
    assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'cambridge-north-quarter');
    assert.equal(r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.25);
    globalThis.window.location=new URL(saved.href.replace('terrain_target=0.25','terrain_target=0.5').replace('terrain_site=cambridge-north-quarter','terrain_site=cambridge-centre'));
    act(()=>listeners.get('popstate')());
    assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'cambridge-centre');
    assert.equal(r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.5);
    act(()=>r.root.findAllByType('button').find(b=>text(b)==='牛津 · 2 个样区').props.onClick());
    assert.equal(globalThis.window.location.hash,'#oxford-terrain-results');assert.equal(globalThis.window.location.searchParams.has('terrain_site'),false);
    assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,'oxford-centre');
    act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

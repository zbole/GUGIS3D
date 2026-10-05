import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {terrainIndex} from '../src/studio/terrainMath.ts';
import {readTerrainResultLink,terrainResultUrl} from '../src/compare/terrainResultLink.ts';
const url=p=>new URL(p,import.meta.url);
const output=fileURLToPath(url('../node_modules/.cache/gugis-tests/newcastle-results.mjs'));
await build({entryPoints:[fileURLToPath(url('../src/compare/PaperTerrainResults.tsx'))],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const {RealTerrainResultSummary:Card}=await import(pathToFileURL(output).href);
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');

test('small UI result view preserves every displayed metric and package from its byte-bound complete publication',async()=>{
  const raw=await readFile(url('../../shared/newcastle-terrain-benchmark.json'));
  const full=JSON.parse(raw),view=JSON.parse(await readFile(url('../../shared/newcastle-terrain-display-v1.json')));
  const sha=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(view.publication_sha256,sha(raw));
  assert.equal(view.builder_sha256,sha((await readFile(url('../../data-pipeline/build_terrain_result_view.py'),'utf8')).replace(/\r\n/g,'\n')));
  assert.deepEqual(view.packages,full.packages);assert.deepEqual(view.targets_m,full.targets_m);
  assert.equal(view.cases.length,full.cases.length);
  for(const c of view.cases){const original=full.cases.find(o=>o.id===c.id);
    for(const [key,value] of Object.entries(c)){if(key==='models')continue;assert.deepEqual(value,original[key]);}
    assert.equal(c.models.length,original.models.length);
    for(const m of c.models){const originalModel=original.models.find(o=>o.family===m.family&&o.target_m===m.target_m);
      for(const [key,value] of Object.entries(m)){
        if(key==='multipatch'){for(const [k,v] of Object.entries(value))assert.deepEqual(v,originalModel.multipatch[k]);}
        else assert.deepEqual(value,originalModel[key]);
      }
    }
  }
});

test('all twelve Newcastle saved functions reproduce every fixed query and control within the certified reference bound',async()=>{
  const report=JSON.parse(await readFile(url('../../shared/newcastle-terrain-benchmark.json')));
  const audit=JSON.parse(await readFile(url('../public/research/newcastle-terrain-benchmark/native-query-audit.json')));
  assert.equal(audit.rows.length,12);
  for(const c of report.cases){
    const folder=`../public/research/newcastle-terrain-benchmark/${c.id}/`;
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

test('Newcastle cards display both format gains and adverse hybrid results, including equal coarse centre models',()=>{
  let r;act(()=>r=create(React.createElement(Card)));
  act(()=>r.root.findAllByType('button').find(b=>text(b)==='纽卡斯尔 · 2 个样区').props.onClick());
  const choose=(name,value)=>act(()=>r.root.findByProps({'aria-label':name}).props.onChange({target:{value}}));
  assert.match(text(r.toJSON()),/小 30\.5%/);assert.match(text(r.toJSON()),/大 8\.3%/);
  assert.match(text(r.toJSON()),/原生三角带在文件体积与全域 E₂ 上同时不劣/);
  assert.match(text(r.toJSON()),/此档未使用直纹面/);
  choose('跨城对标样区','newcastle-north-quarter');
  assert.match(text(r.toJSON()),/小 26\.6%/);assert.match(text(r.toJSON()),/大 21\.8%/);
  assert.match(text(r.toJSON()),/直纹四边形 39/);
  choose('真实地形结果误差目标','.25');assert.match(text(r.toJSON()),/大 34\.0%/);
  choose('真实地形结果误差目标','.5');assert.match(text(r.toJSON()),/大 54\.1%/);
  choose('跨城对标样区','newcastle-centre');
  assert.match(text(r.toJSON()),/小 35\.8%/);assert.match(text(r.toJSON()),/体积相同/);
  assert.match(text(r.toJSON()),/两种表示的文件体积与全域 E₂ 相同/);
  assert.match(text(r.toJSON()),/43 个实际直纹四边形；4 档文件更大/);
  assert.equal(r.root.findAllByType('canvas').length,0);
  for(const link of r.root.findAllByType('a'))assert.ok(link.props.href.startsWith('/research/newcastle-terrain-benchmark/'));
  act(()=>r.unmount());
});

test('Newcastle deep links preserve workspace state and reject samples from another city',()=>{
  for(const site of ['newcastle-centre','newcastle-north-quarter']){
    const u=new URL(terrainResultUrl('http://localhost/compare?city=london&cities=london,bristol&tile_profile=economy',{scope:'newcastle',target:.25,site}));
    assert.deepEqual(readTerrainResultLink(u),{scope:'newcastle',target:.25,site});
    assert.equal(u.searchParams.get('city'),'london');assert.equal(u.searchParams.get('tile_profile'),'economy');
    assert.equal(u.hash,'#newcastle-terrain-results');
  }
  assert.throws(()=>terrainResultUrl('http://localhost/compare',{scope:'newcastle',target:.1,site:'nottingham-centre'}),/different experiment/);
});

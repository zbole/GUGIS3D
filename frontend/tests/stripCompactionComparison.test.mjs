import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {act,create} from 'react-test-renderer';
const source=p=>fileURLToPath(new URL(p,import.meta.url));
const report=JSON.parse(await readFile(source('../../shared/strip-compaction-benchmark.json'),'utf8'));
const outfile=source('../node_modules/.cache/gugis-tests/strip-compaction-ui.mjs');
await build({entryPoints:[source('../src/compare/StripCompactionComparison.tsx')],bundle:true,platform:'node',format:'esm',packages:'external',outfile});
const {default:Comparison,compactOutcome}=await import(pathToFileURL(outfile).href);
const text=n=>typeof n==='string'?n:(n.children??[]).map(text).join('');
const digest=b=>createHash('sha256').update(b).digest('hex');

test('all compaction selections expose three actual byte counts and boundary slope tradeoff',()=>{
  let renderer;act(()=>{renderer=create(React.createElement(Comparison,{caseId:'rotating-direction',target:.1}));});
  for(const c of report.cases)for(const p of c.variants){
    act(()=>renderer.update(React.createElement(Comparison,{caseId:c.id,target:p.target_m})));
    const result=text(renderer.root.findByProps({className:'strip-result'}));
    assert.ok(result.includes(compactOutcome(c.id,p.target_m)));
    const rows=renderer.root.findAll(n=>typeof n.props.className==='string'&&n.props.className.startsWith('strip-cost-row '));
    assert.equal(rows.length,3);
    for(const [i,m] of ['hybrid','compact_hybrid','local_triangles'].entries())assert.ok(text(rows[i]).includes((p[m].bytes/1000).toFixed(2)));
    assert.match(text(renderer.root),/重组会改变首先命中的单侧坡度/);
    assert.match(text(renderer.root),/不能算作曲面逼近算法或内存节省/);
    assert.match(text(renderer.root),/未运行 ArcGIS Pro/);
  }
  assert.match(compactOutcome('rotating-direction',.1),/小 49.5%/);
  assert.match(compactOutcome('steep-plane',.1),/一样大/);
  act(()=>renderer.update(React.createElement(Comparison,{caseId:'swiss-dem-crop',target:.1})));
  assert.match(text(renderer.root),/真实 DEM 待测/);
  assert.equal(renderer.root.findAllByType('a').length,0);
  act(()=>renderer.unmount());
});

test('compacted model controls and function primitives equal originals, with exact metadata costs',async()=>{
  assert.equal(digest(await readFile(source('../../shared/local-triangle-benchmark.json'))),report.parent_sha256);
  assert.deepEqual(JSON.parse(await readFile(source('../public/research/hybrid-terrain/strip-compaction-results.json'),'utf8')),report);
  const primitives=model=>{
    const cyclic=t=>[t,[t[1],t[2],t[0]],[t[2],t[0],t[1]]].map(x=>JSON.stringify(x)).sort()[0];
    return model.patches.flatMap(p=>p.kind==='ruled-strip'?p.left.slice(1).map((_,i)=>`q:${JSON.stringify([p.left[i],p.right[i],p.left[i+1],p.right[i+1]])}`):p.indices.slice(2).map((_,i)=>{
      const a=p.indices[i],b=p.indices[i+1],c=p.indices[i+2];return `t:${cyclic(i%2?[a,c,b]:[a,b,c])}`;
    })).sort();
  };
  let count=0;
  for(const c of report.cases)for(const p of c.variants){
    const models={};
    for(const m of ['hybrid','compact_hybrid','local_triangles']){
      const r=p[m],bytes=await readFile(source(`../public/research/hybrid-terrain/models/${c.id}/${r.filename}`));
      assert.equal(bytes.length,r.bytes);assert.equal(digest(bytes),r.sha256);models[m]=JSON.parse(bytes);
      assert.equal(r.offgrid.samples,4096);assert.equal(r.source_grid.samples,4225);
      assert.ok(r.offgrid.decoded_kernel_max_difference_m<1e-10);
    }
    count++;assert.deepEqual(models.hybrid.points,models.compact_hybrid.points);
    assert.deepEqual(primitives(models.hybrid),primitives(models.compact_hybrid));
    const meta=model=>Object.fromEntries(Object.entries(model).filter(([k])=>!['points','patches'].includes(k)));
    assert.deepEqual(meta(models.hybrid),meta(models.compact_hybrid));assert.deepEqual(meta(models.hybrid),meta(models.local_triangles));
    assert.ok(p.preservation.boundary_queries.max_height_difference_m<1e-10);
    assert.ok(p.preservation.random_queries.max_slope_difference_degrees<1e-10);
    assert.ok(p.preservation.boundary_queries.samples<=2048);
    assert.equal(p.preservation.patch_ids_preserved,false);
    assert.ok(Math.abs(p.organization_saving_percent-100*(1-p.compact_hybrid.bytes/p.hybrid.bytes))<1e-8);
    assert.ok(Math.abs(p.compact_vs_local_saving_percent-100*(1-p.compact_hybrid.bytes/p.local_triangles.bytes))<1e-8);
  }
  assert.equal(count,24);
  const rotating=report.cases.find(c=>c.id==='rotating-direction').variants.find(p=>p.target_m===.1);
  assert.equal(rotating.preservation.boundary_queries.slope_ties_changed,762);
});

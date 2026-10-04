import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {act,create} from 'react-test-renderer';
const source=p=>fileURLToPath(new URL(p,import.meta.url));
const report=JSON.parse(await readFile(source('../../shared/raster-triangle-benchmark.json'),'utf8'));
const outfile=source('../node_modules/.cache/gugis-tests/raster-comparison-ui.mjs');
await build({entryPoints:[source('../src/compare/RasterTerrainComparison.tsx')],bundle:true,platform:'node',format:'esm',packages:'external',outfile});
const {default:Comparison,rasterOutcome}=await import(pathToFileURL(outfile).href);
const text=n=>typeof n==='string'?n:(n.children??[]).map(text).join('');
const digest=b=>createHash('sha256').update(b).digest('hex');

test('real raster comparison shows every adverse outcome and distinguishes reference from ground',()=>{
  let renderer;act(()=>{renderer=create(React.createElement(Comparison,{target:.1}));});
  for(const p of report.cases[0].variants){
    act(()=>renderer.update(React.createElement(Comparison,{target:p.target_m})));
    assert.ok(text(renderer.root.findByProps({className:'strip-result'})).includes(rasterOutcome(p.target_m)));
    assert.equal(renderer.root.findByType('section').props.className.includes('has-loss'),p.compact_vs_local_saving_percent<0);
    assert.match(text(renderer.root),/不能代表未知的实际地面误差/);
    assert.match(text(renderer.root),/不是英国城市 DEM/);
    assert.match(text(renderer.root),/先处理邻面的更长边/);
    assert.match(text(renderer.root),/未声称区间算术的机器证明/);
    assert.match(text(renderer.root),/原记录.*保留/);
    assert.equal(renderer.root.findAllByType('img').length,2);
  }
  assert.match(rasterOutcome(.1),/大 98.0%/);
  act(()=>renderer.unmount());
});

test('twelve actual raster archives have equal metadata, measured costs and continuous bounds',async()=>{
  assert.equal(digest(await readFile(source('../../shared/hybrid-terrain-research.json'))),report.parent_sha256);
  assert.deepEqual(JSON.parse(await readFile(source('../public/research/hybrid-terrain/raster-triangle-results.json'),'utf8')),report);
  const csv=await readFile(source('../public/research/hybrid-terrain/raster-triangle-results.csv'),'utf8');
  assert.equal(csv.includes('\r'),false);assert.equal(csv.trim().split('\n').length,13);
  const c=report.cases[0];let count=0;
  for(const p of c.variants){
    const models=[];
    for(const mode of ['hybrid','compact_hybrid','local_triangles']){
      count++;const receipt=p[mode],content=await readFile(source(`../public/research/hybrid-terrain/models/${c.id}/${receipt.filename}`));
      assert.equal(content.length,receipt.bytes);assert.equal(digest(content),receipt.sha256);models.push(JSON.parse(content));
      assert.equal(receipt.source_grid.samples,16641);assert.equal(receipt.offgrid.samples,4096);
      assert.ok(receipt.continuous_certificate.max_error_bound_m<=p.target_m);
      assert.ok(receipt.offgrid.decoded_kernel_max_difference_m<1e-8);
      const image=await readFile(source(`../public/research/hybrid-terrain/${c.id}-${receipt.filename.replace('.json','.png')}`));
      assert.equal(image.subarray(1,4).toString(),'PNG');assert.equal(image.readUInt32BE(16),784);assert.equal(image.readUInt32BE(20),630);
    }
    const meta=m=>Object.fromEntries(Object.entries(m).filter(([k])=>!['points','patches'].includes(k)));
    assert.deepEqual(meta(models[0]),meta(models[1]));assert.deepEqual(meta(models[0]),meta(models[2]));
    assert.deepEqual(models[0].points,models[1].points);
    assert.ok(Math.abs(p.compact_vs_local_saving_percent-100*(1-p.compact_hybrid.bytes/p.local_triangles.bytes))<1e-8);
    assert.equal(p.comparison_eligible,true);
    assert.equal(p.local_triangles.edge_decision,'longest-edge');
  }
  assert.equal(count,12);
});

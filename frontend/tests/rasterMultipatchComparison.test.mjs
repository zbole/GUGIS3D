import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {act,create} from 'react-test-renderer';
const source=p=>fileURLToPath(new URL(p,import.meta.url));
const report=JSON.parse(await readFile(source('../../shared/raster-multipatch-benchmark.json'),'utf8'));
const outfile=source('../node_modules/.cache/gugis-tests/raster-multipatch-ui.mjs');
await build({entryPoints:[source('../src/compare/RasterMultipatchComparison.tsx')],bundle:true,platform:'node',format:'esm',packages:'external',outfile});
const {default:Comparison,multipatchOutcome}=await import(pathToFileURL(outfile).href);
const text=n=>typeof n==='string'?n:(n.children??[]).map(text).join('');
const digest=b=>createHash('sha256').update(b).digest('hex');

test('exact-geometry format gains and different-surface losses appear together for all targets',()=>{
  let renderer;act(()=>renderer=create(React.createElement(Comparison,{target:.1})));
  for(const row of report.variants){
    act(()=>renderer.update(React.createElement(Comparison,{target:row.target_m})));
    assert.ok(text(renderer.root.findByProps({className:'strip-result'})).includes(multipatchOutcome(row.target_m)));
    assert.match(text(renderer.root),/尚未运行 ArcGIS Pro/);
    assert.match(text(renderer.root),/文件大小比例不代表运行内存或渲染速度/);
    assert.match(text(renderer.root),/不能当作相同几何的格式收益/);
    assert.match(text(renderer.root),/逐字节相同/);
    assert.match(text(renderer.root),/瑞士 EPSG:2056/);
    const download=renderer.root.findAllByType('a').find(a=>a.props.href.endsWith(row.download.filename));
    assert.ok(download);assert.equal(download.props.download,true);
  }
  assert.match(multipatchOutcome(.1),/小 17.6%/);
  assert.match(text(renderer.root),/大 181.5%/);
  act(()=>renderer.update(React.createElement(Comparison,{target:5})));
  assert.equal(renderer.toJSON(),null);act(()=>renderer.unmount());
});

test('four downloadable archives and complete format costs match frozen parent records',async()=>{
  const parent=await readFile(source('../../shared/raster-triangle-benchmark.json'));
  assert.equal(digest(parent),report.parent_sha256);
  assert.deepEqual(JSON.parse(await readFile(source('../public/research/hybrid-terrain/raster-multipatch-results.json'),'utf8')),report);
  const csv=await readFile(source('../public/research/hybrid-terrain/raster-multipatch-results.csv'),'utf8');
  assert.equal(csv.includes('\r'),false);assert.equal(csv.trim().split('\n').length,5);
  for(const row of report.variants){
    const archive=await readFile(source(`../public/research/hybrid-terrain/${row.download.filename}`));
    assert.equal(archive.length,row.download.bytes);assert.equal(digest(archive),row.download.sha256);
    const old=JSON.parse(parent).cases[0].variants.find(p=>p.target_m===row.target_m);
    assert.equal(row.native_bytes,old.local_triangles.bytes);assert.equal(row.native_sha256,old.local_triangles.sha256);
    assert.equal(row.compact_hybrid_bytes,old.compact_hybrid.bytes);
    assert.equal(row.core_bytes,row.components.reduce((sum,p)=>sum+p.bytes,0));
    assert.equal(row.with_native_recovery_bytes,row.core_bytes+row.native_recovery.bytes);
    assert.ok(Math.abs(row.native_vs_core_saving_percent-100*(1-row.native_bytes/row.core_bytes))<1e-8);
    assert.equal(row.arcgis_execution,null);assert.equal(row.byte_identical_native_recovery,true);
    assert.ok(row.offgrid.native_kernel_max_difference_m<1e-8);
  }
});

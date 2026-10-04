import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const hash=value=>createHash('sha256').update(value).digest('hex');
const report=JSON.parse(await readFile(new URL('../../shared/terrain-ray-benchmark.json',import.meta.url)));
const outfile=fileURLToPath(new URL('../node_modules/.cache/gugis-tests/research-ray-audit.mjs',import.meta.url));
await build({entryPoints:[fileURLToPath(new URL('../src/compare/ResearchRayAudit.tsx',import.meta.url))],outfile,
  bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const Audit=(await import(pathToFileURL(outfile).href)).default;
const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join('');

test('ray timings bind all native archives, common fixtures, source kernel and published data',async()=>{
  assert.equal(report.records.length,15);
  const fixtures=JSON.parse(await readFile(new URL('../public/research/hybrid-terrain/ray-fixtures.json',import.meta.url)));
  assert.deepEqual(Object.keys(fixtures).sort(),[...new Set(report.records.map(r=>r.case_id))].sort());
  assert.deepEqual(JSON.parse(await readFile(new URL('../public/research/hybrid-terrain/ray-index-results.json',import.meta.url))),report);
  for(const [name,sha] of Object.entries(report.parents))assert.equal(hash(await readFile(new URL('../../shared/'+name,import.meta.url))),sha);
  const sources={hierarchy:'../src/studio/terrainRayIndex.ts',native_query:'../src/studio/terrainMath.ts',script:'../scripts/measure-terrain-rays.mjs'};
  for(const [key,path] of Object.entries(sources))assert.equal(hash((await readFile(new URL(path,import.meta.url),'utf8')).replace(/\r\n/g,'\n')),report.sources[key]);
  for(const r of report.records){
    const bytes=await readFile(new URL(`../public/research/hybrid-terrain/models/${r.case_id}/${r.filename}`,import.meta.url));
    assert.equal(bytes.length,r.archive_bytes);assert.equal(hash(bytes),r.archive_sha256);
    assert.equal(fixtures[r.case_id].rays.length,r.rays);assert.equal(r.rays,1024);
    assert.equal(hash(JSON.stringify(fixtures[r.case_id].rays)),r.fixture_sha256);
    assert.ok(Number.isFinite(r.query_only_ratio)&&r.query_only_ratio>0);
    assert.ok(Math.abs(r.query_only_ratio-r.linear_batch_median_ms/r.hierarchy_batch_median_ms)<1e-10);
    assert.equal(r.tree.maxSubsetCells,256);assert.equal(r.fallbacks,0);
    const saving=(r.linear_batch_median_ms-r.hierarchy_batch_median_ms)/r.rays;
    assert.equal(r.approximate_build_break_even_rays,saving>0?Math.ceil(r.hierarchy_extra_build_ms/saving):null);
  }
  assert.ok(report.records.some(r=>r.query_only_ratio<1),'negative small-model cases remain public');
});

test('ray audit shows cold construction and negative results, but never borrows another archive result',()=>{
  const r=report.records.find(r=>r.case_id==='swiss-dem-crop'&&r.family==='hybrid');
  let renderer;act(()=>{renderer=create(React.createElement(Audit,{caseId:r.case_id,target:.1,archiveSha256:r.archive_sha256,indexed:false}));});
  assert.match(text(renderer.toJSON()),/38\.7×/);assert.match(text(renderer.toJSON()),/当前点选：原扫描/);
  assert.match(text(renderer.toJSON()),/约 257 条射线/);assert.match(text(renderer.toJSON()),/空间筛选更慢/);
  assert.match(text(renderer.toJSON()),/不是普通点高程查询/);
  act(()=>renderer.update(React.createElement(Audit,{caseId:r.case_id,target:.1,archiveSha256:'0'.repeat(64),indexed:true})));
  assert.match(text(renderer.toJSON()),/没有匹配记录/);assert.doesNotMatch(text(renderer.toJSON()),/38\.7×/);
  act(()=>renderer.unmount());
});

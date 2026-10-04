import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
const report=JSON.parse(await readFile(new URL('../../shared/research-display-reuse.json',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=fileURLToPath(new URL('../node_modules/.cache/gugis-tests/research-display-audit.mjs',import.meta.url));
await build({entryPoints:[fileURLToPath(new URL('../src/compare/ResearchDisplayReuse.tsx',import.meta.url))],outfile:output,
  bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const DisplayAudit=(await import(pathToFileURL(output).href)).default;
const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join('');

test('all 84 display receipts bind actual native files, exact faces and counted geometry buffers',async()=>{
  assert.equal(report.records.length,84);
  assert.deepEqual(JSON.parse(await readFile(new URL('../public/research/hybrid-terrain/display-reuse-results.json',import.meta.url))),report);
  for(const [name,sha] of Object.entries(report.parents))assert.equal(hash(await readFile(new URL('../../shared/'+name,import.meta.url))),sha);
  const sources={mesh:'../src/compare/researchTerrainMesh.ts',geometry:'../src/studio/terrainScene.ts',native_query:'../src/studio/terrainMath.ts',script:'../scripts/measure-research-display.mjs'};
  for(const [key,path] of Object.entries(sources))assert.equal(hash((await readFile(new URL(path,import.meta.url),'utf8')).replace(/\r\n/g,'\n')),report.sources[key]);
  const figures=JSON.parse(await readFile(new URL('../public/research/hybrid-terrain/display-reuse/figures.json',import.meta.url)));
  assert.equal(figures.source_sha256,hash(await readFile(new URL('../../shared/research-display-reuse.json',import.meta.url))));
  assert.equal(figures.plotter_sha256,hash((await readFile(new URL('../../data-pipeline/plot_research_display_reuse.py',import.meta.url),'utf8')).replace(/\r\n/g,'\n')));
  for(const [name,r] of Object.entries(figures.figure_files)){
    const raw=await readFile(new URL('../public/research/hybrid-terrain/display-reuse/'+name,import.meta.url));assert.equal(raw.length,r.bytes);assert.equal(hash(raw),r.sha256);
  }
  for(const r of report.records){
    const raw=await readFile(new URL(`../public/research/hybrid-terrain/models/${r.case_id}/${r.filename}`,import.meta.url));
    assert.equal(raw.length,r.archive_bytes);assert.equal(hash(raw),r.archive_sha256);
    assert.equal(r.expanded.face_sha256,r.shared.face_sha256);assert.equal(r.expanded.triangles,r.shared.triangles);
    assert.equal(r.expanded.display_bound_m,r.shared.display_bound_m);assert.equal(r.expanded.capped,r.shared.capped);
    for(const m of [r.expanded,r.shared]){
      assert.equal(m.position_bytes,m.vertices*24);assert.equal(m.normal_bytes,m.vertices*12);assert.equal(m.index_bytes,m.triangles*12);
      assert.equal(m.typed_array_bytes,m.position_bytes+m.normal_bytes+m.index_bytes);assert.ok(Number.isFinite(m.prepare_ms)&&m.prepare_ms>=0);
    }
    assert.ok(r.shared.vertices<=r.expanded.vertices);
    assert.ok(Math.abs(r.buffer_saving_percent-(1-r.shared.typed_array_bytes/r.expanded.typed_array_bytes)*100)<1e-10);
  }
});

test('display audit refuses results from a different archive even with matching case and error target',()=>{
  const r=report.records.find(r=>r.case_id==='swiss-dem-crop'&&r.target_m===.1&&r.family==='compact_hybrid');
  let renderer;act(()=>{renderer=create(React.createElement(DisplayAudit,{caseId:r.case_id,target:r.target_m,archiveSha256:r.archive_sha256,shared:true}));});
  assert.match(text(renderer.toJSON()),/74\.7%/);assert.match(text(renderer.toJSON()),/不是显卡内存实测/);
  act(()=>renderer.update(React.createElement(DisplayAudit,{caseId:r.case_id,target:r.target_m,archiveSha256:'0'.repeat(64),shared:true})));
  assert.match(text(renderer.toJSON()),/没有匹配/);assert.doesNotMatch(text(renderer.toJSON()),/74\.7%/);
  act(()=>renderer.unmount());
});

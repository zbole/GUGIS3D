import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const file=p=>new URL(p,import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(file('../../shared/bristol-local-partition.json')),report=JSON.parse(bytes);
const summary=JSON.parse(await readFile(file('../../shared/bristol-local-partition-summary.json')));
const outfile=fileURLToPath(file('../node_modules/.cache/gugis-tests/bristol-local-partition-ui.mjs'));
await build({entryPoints:[fileURLToPath(file('../src/compare/BristolLocalPartitionComparison.tsx'))],outfile,
  bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const Card=(await import(pathToFileURL(outfile).href)).default;
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');

test('local partition UI presents all harbour gains and hill penalties, C0 limits and rejects unmeasured targets',()=>{
  let renderer;act(()=>renderer=create(React.createElement(Card,{target:.1})));
  for(const target of [.1,.25,.5]){
    act(()=>renderer.update(React.createElement(Card,{target})));
    const content=text(renderer.toJSON());
    assert.match(content,/山坡三档仍更大/);assert.match(content,/不保证法线 C1 连续/);
    assert.match(content,/不同的认证曲面/);assert.match(content,/不能当作相同几何的格式收益/);
    for(const data of report.cases){const p=data.variants.find(p=>p.target_m===target);
      assert.ok(content.includes((p.compact_local_hybrid.bytes/1000).toFixed(2)));
      assert.ok(content.includes(Math.abs(p.vs_local_triangles_saving_percent).toFixed(1)+'%'));
    }
  }
  act(()=>renderer.update(React.createElement(Card,{target:.05})));
  assert.match(text(renderer.toJSON()),/尚无局部分区实测/);assert.doesNotMatch(text(renderer.toJSON()),/53\.6%/);
  act(()=>renderer.unmount());
});

test('thin UI summary, reference bindings, closure receipts and every shipped model package stay bound to the full report',async()=>{
  assert.equal(summary.full_report_sha256,hash(bytes));assert.equal(hash(await readFile(file('../../shared/bristol-certified-terrain.json'))),report.parent_sha256);
  assert.deepEqual(JSON.parse(await readFile(file('../public/research/bristol-local-partition/results.json'))),report);
  assert.equal(hash((await readFile(file('../src/studio/terrainMath.ts'),'utf8')).replace(/\r\n/g,'\n')),report.native_kernel_sha256);
  assert.equal(hash((await readFile(file('../scripts/audit-bristol-local-partition.mjs'),'utf8')).replace(/\r\n/g,'\n')),report.native_runner_sha256);
  for(const [path,sha] of Object.entries(report.scripts))assert.equal(hash((await readFile(file('../../'+path),'utf8')).replace(/\r\n/g,'\n')),sha,path);
  for(const data of report.cases){
    const packageBytes=await readFile(file('../public/research/bristol-local-partition/'+data.download.filename));
    assert.equal(packageBytes.length,data.download.bytes);assert.equal(hash(packageBytes),data.download.sha256);
    const thin=summary.cases.find(c=>c.id===data.id);
    for(const pair of data.variants){
      const slim=thin.variants.find(p=>p.target_m===pair.target_m);
      assert.equal('history' in slim.receipt,false);assert.equal('cells_source_indices' in slim.receipt,false);
      for(const family of ['local_hybrid','compact_local_hybrid']){
        const model=pair[family],q=model.query_audit;
        assert.deepEqual(slim[family],model);assert.ok(model.continuous_bound_m<=pair.target_m);
        assert.equal(model.closure.c0_shared_ids_and_edge_traces,true);assert.equal(model.closure.c1_claim,false);
        assert.ok(Math.abs(model.closure.xy_area_m2-4096)<1e-8);assert.ok(model.closure.internal_edges_paired>0);
        assert.equal(q.hits,q.queries);assert.equal(q.queries,4096);assert.equal(q.source_centres,4225);assert.equal(q.boundary_queries,256);
        assert.equal(q.archive_sha256,model.sha256);assert.equal(q.fixture_sha256,data.fixture_sha256);
      }
      assert.ok(pair.compact_local_hybrid.query_audit.compaction_max_height_difference_m<1e-9);
      assert.ok(pair.vs_global_compact_saving_percent>0);
      assert.equal(pair.vs_local_triangles_saving_percent>0,data.id==='bristol-harbour');
    }
  }
  assert.equal((await readFile(file('../public/research/bristol-local-partition/results.csv'),'utf8')).trim().split('\n').length,13);
  const figures=JSON.parse(await readFile(file('../public/research/bristol-local-partition/figures.json')));
  assert.equal(figures.report_sha256,hash(bytes));
  assert.equal(figures.plotter_sha256,hash((await readFile(file('../../data-pipeline/plot_bristol_local_partition.py'),'utf8')).replace(/\r\n/g,'\n')));
  for(const figure of figures.figures){const b=await readFile(file('../public/research/bristol-local-partition/'+figure.filename));assert.equal(b.length,figure.bytes);assert.equal(hash(b),figure.sha256);}
});

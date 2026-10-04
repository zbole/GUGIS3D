import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const hash=b=>createHash('sha256').update(b).digest('hex');
const file=p=>new URL(p,import.meta.url);
const reportBytes=await readFile(file('../../shared/bristol-certified-terrain.json'));
const report=JSON.parse(reportBytes);
const outfile=fileURLToPath(file('../node_modules/.cache/gugis-tests/bristol-certified-ui.mjs'));
await build({entryPoints:[fileURLToPath(file('../src/compare/BristolTerrainBenchmark.tsx'))],outfile,
  bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const Card=(await import(pathToFileURL(outfile).href)).default;
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');

test('a direct result anchor scrolls after rendering and cancels pending work on unmount',()=>{
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  let frame,requested,cancelled,scrolled=0,renderer;
  globalThis.window={location:{hash:'#bristol-terrain-benchmark'},requestAnimationFrame:fn=>{frame=fn;return 42;},cancelAnimationFrame:id=>{cancelled=id;}};
  globalThis.document={getElementById:id=>{requested=id;return {scrollIntoView:()=>scrolled++};}};
  try{
    act(()=>{renderer=create(React.createElement(Card));});
    assert.equal(scrolled,0);frame();assert.equal(requested,'bristol-terrain-benchmark');assert.equal(scrolled,1);
    act(()=>renderer.unmount());assert.equal(cancelled,42);
  }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;}
});

test('real Bristol shows both format savings and hybrid losses across every target without ArcGIS runtime claims',()=>{
  let renderer;act(()=>{renderer=create(React.createElement(Card));});
  for(const target of [.1,.25,.5]){
    act(()=>renderer.root.findByProps({'aria-label':'真实 Bristol 最大误差目标'}).props.onChange({target:{value:String(target)}}));
    const content=text(renderer.toJSON());
    assert.match(content,/未运行 ArcGIS 软件/);assert.match(content,/局部三角带均小于紧凑混合面带/);
    assert.match(content,/不是未知真实地面的精度保证/);assert.match(content,/未转换为城市 ENU/);
    assert.match(content,/不保证字节数单调/);assert.match(content,/逐字节一致/);
    for(const data of report.cases){
      const p=data.variants.find(p=>p.target_m===target);
      assert.ok(content.includes(p.multipatch.native_vs_core_saving_percent.toFixed(1)+'%'));
      assert.ok(content.includes((p.local_triangles.bytes/1000).toFixed(2)));
    }
  }
  for(const data of report.cases)assert.ok(renderer.root.findAllByType('a').some(a=>a.props.download===true&&a.props.href.endsWith(data.download.filename)));
  act(()=>renderer.unmount());
});

test('fixed sources, packages, full cost sums, query scripts and figures remain bound to the published results',async()=>{
  assert.deepEqual(JSON.parse(await readFile(file('../public/research/bristol-certified/results.json'))),report);
  const raster=await readFile(file('../../backend/data/terrain/bristol-ea-dtm-1m.tif'));
  assert.equal(hash(raster),report.raster_sha256);
  assert.equal(hash((await readFile(file('../src/studio/terrainMath.ts'),'utf8')).replace(/\r\n/g,'\n')),report.native_kernel_sha256);
  assert.equal(hash((await readFile(file('../scripts/audit-bristol-certified.mjs'),'utf8')).replace(/\r\n/g,'\n')),report.native_runner_sha256);
  for(const [path,sha] of Object.entries(report.scripts))assert.equal(hash((await readFile(file('../../'+path),'utf8')).replace(/\r\n/g,'\n')),sha,path);
  assert.equal(report.cases.length,2);assert.equal(report.arcgis_execution,null);
  for(const data of report.cases){
    assert.deepEqual(data.shape,[65,65]);assert.equal(data.nodata,0);
    const bytes=await readFile(file('../public/research/bristol-certified/'+data.download.filename));
    assert.equal(bytes.length,data.download.bytes);assert.equal(hash(bytes),data.download.sha256);
    assert.deepEqual(data.variants.map(p=>p.target_m),[.1,.25,.5]);
    for(const p of data.variants){
      assert.ok(p.compact_hybrid.bytes>p.local_triangles.bytes,'negative outcomes must remain visible');
      for(const family of ['hybrid','compact_hybrid','local_triangles']){
        const model=p[family],audit=model.query_audit;
        assert.ok(model.target_met&&model.continuous_bound_m<=p.target_m);
        assert.equal(audit.hits,audit.queries);assert.equal(audit.queries,4096);assert.equal(audit.source_centres,4225);
        assert.equal(audit.archive_sha256,model.sha256);assert.equal(audit.fixture_sha256,data.fixture_sha256);
        assert.ok(audit.max_sampled_m<=model.continuous_bound_m+1e-9);
      }
      assert.ok(p.compact_hybrid.query_audit.compaction_max_height_difference_m<1e-9);
      const mp=p.multipatch;
      assert.equal(mp.core_bytes,mp.components.reduce((s,c)=>s+c.bytes,0));
      assert.equal(mp.recoverable_bytes,mp.core_bytes+mp.native_recovery.bytes);
      assert.equal(mp.native_recovery_byte_identical,true);assert.equal(mp.arcgis_execution,null);
      assert.ok(mp.native_height_max_difference_m<=1e-8);
      assert.ok(Math.abs(mp.native_vs_core_saving_percent-100*(1-p.local_triangles.bytes/mp.core_bytes))<1e-10);
    }
  }
  assert.equal((await readFile(file('../public/research/bristol-certified/results.csv'),'utf8')).trim().split('\n').length,19);
  const figures=JSON.parse(await readFile(file('../public/research/bristol-certified/figures.json')));
  assert.equal(figures.report_sha256,hash(reportBytes));
  assert.equal(figures.plotter_sha256,hash((await readFile(file('../../data-pipeline/plot_bristol_terrain_benchmark.py'),'utf8')).replace(/\r\n/g,'\n')));
  for(const figure of figures.figures){const bytes=await readFile(file('../public/research/bristol-certified/'+figure.filename));assert.equal(bytes.length,figure.bytes);assert.equal(hash(bytes),figure.sha256);}
});

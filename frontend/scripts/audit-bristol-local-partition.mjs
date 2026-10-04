/** Local-partition derivative: same fixed Bristol fixtures and unchanged native kernel. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(process.argv[2]);
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=root+'frontend/src/studio/terrainMath.ts';
await build({entryPoints:[source],outfile:join(out,'kernel.mjs'),bundle:true,platform:'node',format:'esm'});
const {terrainIndex}=await import(pathToFileURL(join(out,'kernel.mjs')).href);
const parentBytes=await readFile(join(out,'results.json')),report=JSON.parse(parentBytes);
assert.equal(report.schema,'gugis-bristol-local-partition-v1');
const records=[];
for(const data of report.cases){
  assert.ok(['bristol-harbour','bristol-brandon-hill'].includes(data.id));
  const folder=join(out,data.id);
  const fixtureBytes=await readFile(join(folder,'query-fixture.json')),fixture=JSON.parse(fixtureBytes);
  const referenceBytes=await readFile(join(folder,'reference.json')),reference=JSON.parse(referenceBytes);
  assert.equal(hash(fixtureBytes),data.fixture_sha256);assert.equal(hash(referenceBytes),data.reference_sha256);
  assert.equal(fixture.xy.length,4096);
  const grid=reference.y.flatMap((y,row)=>reference.x.map((x,col)=>[x,y,reference.height[row][col]]));
  const boundaries=grid.filter(([x,y])=>Math.abs(x)===32||Math.abs(y)===32);
  for(const pair of data.variants){
    let hybridValues;
    for(const family of ['local_hybrid','compact_local_hybrid']){
      const model=pair[family];
      assert.equal(model.filename,`${family}-${pair.target_m}m.json`);
      const content=await readFile(join(folder,model.filename));
      assert.equal(hash(content),model.sha256);assert.equal(content.length,model.bytes);
      const terrain=JSON.parse(content),start=performance.now(),index=terrainIndex(terrain);
      const indexMs=performance.now()-start;
      const run=()=>fixture.xy.map(([x,y])=>index.query(x,y)?.height??null);
      run();const times=[];let values;
      for(let i=0;i<5;i++){const begin=performance.now();values=run();times.push(performance.now()-begin);}
      assert.ok(values.every(Number.isFinite),'no off-grid query holes');
      const errors=values.map((v,i)=>v-fixture.reference[i]),absolute=errors.map(Math.abs).sort((a,b)=>a-b);
      assert.ok(absolute.at(-1)<=model.continuous_bound_m+1e-9,'native kernel obeys saved certificate at sampled sites');
      const gridErrors=grid.map(([x,y,z])=>{const hit=index.query(x,y);assert.ok(hit,'all source centres must hit');return Math.abs(hit.height-z);});
      assert.ok(Math.max(...gridErrors)<=model.continuous_bound_m+1e-9);
      const boundaryHits=boundaries.map(([x,y])=>{const hit=index.query(x,y);assert.ok(hit);return hit.height;});
      let compactionDifference=null;
      if(family==='local_hybrid')hybridValues={values,boundaryHits};
      if(family==='compact_local_hybrid'){
        compactionDifference=Math.max(...values.map((v,i)=>Math.abs(v-hybridValues.values[i])),
          ...boundaryHits.map((v,i)=>Math.abs(v-hybridValues.boundaryHits[i])));
        assert.ok(compactionDifference<1e-9,'regrouping preserves native heights including the boundary');
      }
      const fields=['x_bng_offset_m','y_bng_offset_m','reference_odn_m','native_odn_m','difference_m'];
      const csv=[fields.join(','),...fixture.xy.map(([x,y],i)=>[x,y,fixture.reference[i],values[i],errors[i]].join(','))].join('\n')+'\n';
      const csvName=`queries-${family}-${pair.target_m}m.csv`;
      await writeFile(join(folder,csvName),csv);
      const record={case_id:data.id,target_m:pair.target_m,family,archive_sha256:model.sha256,
        fixture_sha256:data.fixture_sha256,queries:4096,hits:4096,source_centres:grid.length,boundary_queries:boundaries.length,
        rmse_m:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),p95_absolute_m:absolute[Math.ceil(.95*absolute.length)-1],
        max_sampled_m:absolute.at(-1),max_source_centre_m:Math.max(...gridErrors),
        compaction_max_height_difference_m:compactionDifference,index_ms:indexMs,query_batches_ms:times,
        query_batch_median_ms:[...times].sort((a,b)=>a-b)[2],index_statistics:index.statistics,
        csv:{filename:csvName,bytes:Buffer.byteLength(csv),sha256:hash(csv)}};
      records.push(record);
    }
    console.log(JSON.stringify({case:data.id,target:pair.target_m,queries:4096,source_centres:grid.length}));
  }
}
await writeFile(join(out,'native-audit.json'),JSON.stringify({parent_sha256:hash(parentBytes),runtime:process.version,
  native_kernel_sha256:hash((await readFile(source,'utf8')).replace(/\r\n/g,'\n')),
  runner_sha256:hash((await readFile(fileURLToPath(import.meta.url),'utf8')).replace(/\r\n/g,'\n')),
  scope:'CPU native point queries; 5 warm batches, index build separate. No GPU/heap/ArcGIS software measurement.',records},null,2)+'\n');

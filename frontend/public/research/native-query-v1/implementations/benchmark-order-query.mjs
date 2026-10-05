import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../../',import.meta.url)),folder=process.argv[2],pieces=process.argv[3];
if(!folder||!pieces)throw new Error('Provide a fresh private output directory and fixed piecewise fixture directory');
const sha=b=>createHash('sha256').update(b).digest('hex');
const codeSha=async p=>sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n'));
await mkdir(folder,{recursive:false});
const raw=await readFile(root+'shared/terrain-order-control-v1.json'),parent=JSON.parse(raw);
assert.equal(parent.schema,'gugis-terrain-order-control-v1');
assert.deepEqual(raw,await readFile(root+'frontend/public/research/order-controls-v1/publication.json'));
const pieceRaw=await readFile(pieces+'/results.json'),pieceReport=JSON.parse(pieceRaw);
assert.equal(pieceReport.schema,'gugis-piecewise-ruled-control-v1');assert.deepEqual(pieceReport.counts,[8,32,128]);
for(const [name,h] of Object.entries(pieceReport.scripts))assert.equal(await codeSha(name),h);
for(const [entry,out] of [['preparedOrderQuery.ts','prepared.mjs'],['terrainOrderMath.ts','frozen.mjs']]){
  await build({entryPoints:[root+'frontend/src/compare/'+entry],outfile:folder+'/'+out,bundle:true,platform:'node',format:'esm'});
}
const {prepareOrderQuery}=await import(pathToFileURL(folder+'/prepared.mjs').href);
const {decodeOrderBinary,orderQuery,validateOrderModel}=await import(pathToFileURL(folder+'/frozen.mjs').href);
const points=[];
for(let i=0;i<128;i++)for(let j=0;j<32;j++)points.push([-50+(i+.38196601125)*100/128,-50+(j+.61803398875)*100/32]);
const fixtureRaw=Buffer.from(JSON.stringify({schema:'gugis-native-query-lattice-v1',points,scope:'4096 deterministic interior locations, identical across both methods; not a whole-domain error metric.'})+'\n');
await writeFile(folder+'/query-fixture.json',fixtureRaw);
const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)];
const stats=values=>({median:quantile(values,.5),p10:quantile(values,.1),p90:quantile(values,.9),minimum:Math.min(...values),maximum:Math.max(...values)});
const source=(c,x,y)=>c.strips?(()=>{
  const w=100/c.strips,j=Math.min(c.strips-1,Math.max(0,Math.floor((x+50)/w))),l=-50+j*w;
  const a=(.2+.05*Math.cos(2*Math.PI*j/c.strips))/(w*w),s=(x-l)*(x-l-w);
  return {height:30+.001*x+.002*y+a*s*(1+.002*y),gradient:[.001+a*(2*(x-l)-w)*(1+.002*y),.002+.002*a*s]};
})():c.id==='extruded-quadratic'?
  {height:30+.002*x*x+.03*y,gradient:[.004*x,.03]}:
  {height:30+.00002*x*x*(y+60)+.01*y,gradient:[.00004*x*(y+60),.00002*x*x+.01]};
function run(query,loops){
  let checksum=0;
  const start=performance.now();
  for(let repeat=0;repeat<loops;repeat++)for(let i=0;i<points.length;i++){
    const q=query(points[i][0],points[i][1]);
    if(!q)throw new Error('Benchmark query unexpectedly missed');
    checksum+=q.height+17*q.gradient[0]+23*q.gradient[1];
  }
  return {elapsed_ms:performance.now()-start,queries:loops*points.length,checksum};
}
const report={schema:'gugis-native-query-performance-v1',generated_utc:new Date().toISOString(),
  parent_publication_sha256:sha(raw),piecewise_report_sha256:sha(pieceRaw),fixture:{filename:'query-fixture.json',bytes:fixtureRaw.length,sha256:sha(fixtureRaw),points:4096},
  scripts:{'frontend/scripts/benchmark-order-query.mjs':await codeSha('frontend/scripts/benchmark-order-query.mjs'),
    'frontend/src/compare/preparedOrderQuery.ts':await codeSha('frontend/src/compare/preparedOrderQuery.ts'),
    'frontend/src/compare/terrainOrderMath.ts':await codeSha('frontend/src/compare/terrainOrderMath.ts'),
    'frontend/src/compare/curvedRuledMath.ts':await codeSha('frontend/src/compare/curvedRuledMath.ts')},
  environment:{node:process.version,v8:process.versions.v8,platform:process.platform,architecture:process.arch,
    cpu_model:os.cpus()[0]?.model??'unavailable',logical_cores:os.cpus().length,total_memory_bytes:os.totalmem()},
  protocol:{operation:'CPU point location + native height + analytic Cartesian gradient + consumed checksum',
    preparation:'Both families validated, polynomial coefficients compiled once. Both scan directly for <=8 patches, otherwise use the same 32x32 bounding-box index; P2 omits known cubic terms. Saved binary files unchanged.',
    warmup_batches_per_method:5,prepared_trials:17,legacy_trials:5,calibration_target_fast_ms:30,max_batch_loops:128,
    order:'Alternate GUGIS/triangle and triangle/GUGIS each trial. Common loop count per case from faster calibrated median; no file I/O, decoding, preparation or correctness assertions inside timed blocks.',
    variation:'p10/p90 are observed trial quantiles, NOT confidence intervals or cross-device guarantees.',
    limits:'Node CPU measurements on this machine and five fixed exact analytic structure fixtures, including C0 piecewise surfaces. Not browser/GPU rendering, ArcGIS software, memory consumption, paper-author timing or general optimality.'},cases:[]};
const csv=['case_id,implementation,family,trial,execution_order,elapsed_ms,queries,ns_per_query,checksum'];
for(const c of [...parent.structure_fixtures,...pieceReport.structure_fixtures]){
  assert.ok(c.both_numerically_exact&&c.ruled.e2_m2<1e-8&&c.triangles.e2_m2<1e-8);
  const methods=[];
  for(const [family,e] of [['ruled',c.ruled],['triangles',c.triangles]]){
    const base=c.strips?pieces:root+'frontend/public/research/order-controls-v1';
    const b=await readFile(`${base}/${c.id}/${e.binary_filename}`),j=await readFile(`${base}/${c.id}/${e.filename}`);
    assert.equal(b.length,e.binary_bytes);assert.equal(sha(b),e.binary_sha256);
    assert.equal(j.length,e.bytes);assert.equal(sha(j),e.sha256);
    const model=decodeOrderBinary(b),start=performance.now(),prepared=prepareOrderQuery(model);
    assert.deepEqual(model,validateOrderModel(JSON.parse(j)));
    prepared.query(0,0);const prepare_ms=performance.now()-start;
    let max_height_m=0,max_gradient=0,max_prepared_legacy_difference=0;
    for(const [x,y] of [...points,[-50,-50],[-50,50],[50,-50],[50,50]]){
      const q=prepared.query(x,y),original=orderQuery(model,x,y),expected=source(c,x,y);assert.ok(q&&original);
      max_height_m=Math.max(max_height_m,Math.abs(q.height-expected.height));
      max_prepared_legacy_difference=Math.max(max_prepared_legacy_difference,Math.abs(q.height-original.height));
      for(let k=0;k<2;k++){
        max_gradient=Math.max(max_gradient,Math.abs(q.gradient[k]-expected.gradient[k]));
        max_prepared_legacy_difference=Math.max(max_prepared_legacy_difference,Math.abs(q.gradient[k]-original.gradient[k]));
      }
    }
    assert.ok(max_height_m<1e-9&&max_gradient<1e-9&&max_prepared_legacy_difference<1e-9);
    const legacy=(x,y)=>orderQuery(model,x,y);
    for(let k=0;k<5;k++){run(prepared.query,1);run(legacy,1);}
    methods.push({family,binary_filename:e.binary_filename,binary_bytes:b.length,binary_sha256:e.binary_sha256,controls:model.points.length,patches:model.patches.length,
      e2_m2:e.e2_m2,prepare_ms,correctness:{requested:points.length+4,hits:points.length+4,max_height_m,max_gradient,max_prepared_legacy_difference},
      prepared:prepared.query,legacy});
  }
  const calibration=methods.map(m=>stats(Array.from({length:3},()=>run(m.prepared,1).elapsed_ms)).median);
  const loops=Math.max(1,Math.min(128,Math.ceil(30/Math.max(.001,Math.min(...calibration)))));
  const legacyCalibration=methods.map(m=>stats(Array.from({length:3},()=>run(m.legacy,1).elapsed_ms)).median);
  const legacyLoops=Math.max(1,Math.min(128,Math.ceil(30/Math.max(.001,Math.min(...legacyCalibration)))));
  const rows=[];
  for(const [implementation,trials] of [['prepared',17],['legacy',5]])for(let trial=0;trial<trials;trial++){
    const order=trial%2?[1,0]:[0,1];
    for(const [position,index] of order.entries()){
      const m=methods[index],result=run(m[implementation],implementation==='prepared'?loops:legacyLoops),ns_per_query=result.elapsed_ms*1e6/result.queries;
      const row={implementation,family:m.family,trial,execution_order:position,...result,ns_per_query};
      rows.push(row);csv.push([c.id,implementation,m.family,trial,position,result.elapsed_ms,result.queries,ns_per_query,result.checksum].join(','));
    }
  }
  for(const m of methods)for(const implementation of ['prepared','legacy']){
    const values=rows.filter(r=>r.family===m.family&&r.implementation===implementation);const checks=values.map(r=>r.checksum);
    assert.ok(Math.max(...checks)-Math.min(...checks)<1e-8*Math.max(1,Math.abs(checks[0])));
  }
  const summaries=methods.map(m=>({family:m.family,binary_filename:m.binary_filename,binary_bytes:m.binary_bytes,binary_sha256:m.binary_sha256,controls:m.controls,patches:m.patches,
    e2_m2:m.e2_m2,prepare_ms:m.prepare_ms,correctness:m.correctness,
    prepared_ns_per_query:stats(rows.filter(r=>r.family===m.family&&r.implementation==='prepared').map(r=>r.ns_per_query)),
    legacy_ns_per_query:stats(rows.filter(r=>r.family===m.family&&r.implementation==='legacy').map(r=>r.ns_per_query))}));
  const a=summaries[0],b=summaries[1];
  const paired=Array.from({length:17},(_,trial)=>{
    const r=rows.find(r=>r.trial===trial&&r.implementation==='prepared'&&r.family==='ruled');
    const t=rows.find(r=>r.trial===trial&&r.implementation==='prepared'&&r.family==='triangles');
    assert.ok(Math.abs(r.checksum-t.checksum)<1e-8*Math.max(1,Math.abs(r.checksum)));
    return t.ns_per_query/r.ns_per_query;
  });
  const record={id:c.id,name:c.name,strips:c.strips??1,triangle_degree:c.triangle_degree,loops,legacy_loops:legacyLoops,queries_per_trial:loops*points.length,
    calibration_ms_per_4096:calibration,legacy_calibration_ms_per_4096:legacyCalibration,methods:summaries,paired_speed_ratio:stats(paired),
    ruled_vs_prepared_triangle_median_ratio:b.prepared_ns_per_query.median/a.prepared_ns_per_query.median,
    scope:c.scope,rows};report.cases.push(record);
  console.log(c.id,'prepared triangle / ruled median ratio',record.ruled_vs_prepared_triangle_median_ratio.toFixed(3),
    'ns/query',a.prepared_ns_per_query.median.toFixed(1),b.prepared_ns_per_query.median.toFixed(1));
}
const csvRaw=Buffer.from(csv.join('\n')+'\n');await writeFile(folder+'/trials.csv',csvRaw);
report.trials_csv={filename:'trials.csv',bytes:csvRaw.length,sha256:sha(csvRaw)};
await writeFile(folder+'/results.json',JSON.stringify(report,null,2)+'\n');

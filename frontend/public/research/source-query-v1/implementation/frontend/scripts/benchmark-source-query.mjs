import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import assert from 'node:assert/strict';
import {bundleWorkspaceModule} from '../tests/bundleWorkspaceModule.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=process.argv[2],protocolFile=process.argv[3];
if(!folder||!protocolFile)throw new Error('Provide fresh output directory and frozen protocol');
const sha=b=>createHash('sha256').update(b).digest('hex'),codeSha=async p=>sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n'));
await mkdir(folder,{recursive:false});
const protocolRaw=await readFile(protocolFile),protocol=JSON.parse(protocolRaw),parentRaw=await readFile(root+'shared/source-native-bands-v1.json'),parent=JSON.parse(parentRaw);
assert.equal(sha(parentRaw),protocol.source_publication_sha256);assert.deepEqual(parentRaw,await readFile(root+'frontend/public/research/source-native-bands-v1/publication.json'));assert.equal(parent.cases.length,20);
await bundleWorkspaceModule(root+'frontend/src/compare/compactSourceBandQuery.ts',folder+'/compact.mjs');
await bundleWorkspaceModule(root+'frontend/src/compare/sourceRuledBandMath.ts',folder+'/frozen.mjs');
const {prepareCompactSourceBandQuery}=await import(pathToFileURL(folder+'/compact.mjs').href);
const {decodeSourceBandBinary,decodeRegularGridBinary,prepareSourceBandQuery,prepareRegularGridQuery}=await import(pathToFileURL(folder+'/frozen.mjs').href);
const points=[];for(let i=0;i<128;i++)for(let j=0;j<32;j++)points.push([-32+(i+.38196601125)/2,-32+(j+.61803398875)*2]);
const fixtureRaw=Buffer.from(JSON.stringify({schema:'gugis-source-query-lattice-v1',points,scope:'4096 fixed interior positions for every saved source; not a whole-domain error metric'})+'\n');await writeFile(folder+'/query-fixture.json',fixtureRaw);
export function permutations(items){return items.length?items.flatMap((v,i)=>permutations(items.filter((_,k)=>k!==i)).map(t=>[v,...t])):[[]];}
const orders=permutations([0,1,2,3]);assert.equal(orders.length,24);
const quantile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)],stats=a=>({median:quantile(a,.5),p10:quantile(a,.1),p90:quantile(a,.9),minimum:Math.min(...a),maximum:Math.max(...a)});
function run(query,loops){let checksum=0;const start=performance.now();for(let repeat=0;repeat<loops;repeat++)for(let i=0;i<points.length;i++){const q=query(points[i][0],points[i][1]);if(!q)throw new Error('Native query missed');checksum+=q.height+17*q.gradient[0]+23*q.gradient[1];}return {elapsed_ms:performance.now()-start,queries:loops*points.length,checksum};}
const scripts={};for(const p of ['frontend/scripts/benchmark-source-query.mjs','frontend/tests/bundleWorkspaceModule.mjs','frontend/src/compare/compactSourceBandQuery.ts','frontend/src/compare/sourceRuledBandMath.ts','frontend/src/compare/principalRuledMath.ts'])scripts[p]=await codeSha(p);
const report={schema:'gugis-source-query-run-v1',generated_utc:new Date().toISOString(),protocol_sha256:sha(protocolRaw),source_publication_sha256:sha(parentRaw),scripts,compiled_sha256:{'compact.mjs':sha(await readFile(folder+'/compact.mjs')),'frozen.mjs':sha(await readFile(folder+'/frozen.mjs'))},fixture:{filename:'query-fixture.json',bytes:fixtureRaw.length,sha256:sha(fixtureRaw),points:4096},environment:{node:process.version,v8:process.versions.v8,platform:process.platform,architecture:process.arch,cpu_model:os.cpus()[0]?.model??'unavailable',logical_cores:os.cpus().length,total_memory_bytes:os.totalmem()},cases:[]};
const csv=['case_id,family,trial,execution_order,elapsed_ms,queries,ns_per_query,checksum'];
for(const c of parent.cases){
  const entries=[c.models.find(m=>m.family==='ruled'),c.models.find(m=>m.family==='source_p2'),c.regular_grid],models=[];
  for(const e of entries){const filename=e.binary_filename??e.filename,bytes=e.binary_bytes??e.bytes,hash=e.binary_sha256??e.sha256,raw=await readFile(`${root}frontend/public/research/source-native-bands-v1/${c.id}/${filename}`);assert.equal(raw.length,bytes);assert.equal(sha(raw),hash);models.push(filename==='regular-grid.bin'?decodeRegularGridBinary(raw):decodeSourceBandBinary(raw));}
  const preparations=[()=>prepareCompactSourceBandQuery(models[0]),()=>prepareSourceBandQuery(models[0]),()=>prepareSourceBandQuery(models[1]),()=>prepareRegularGridQuery(models[2])],methods=[];
  for(let i=0;i<4;i++){const start=performance.now(),prepared=preparations[i](),prepare_ms=performance.now()-start;let max_height_m=0,max_gradient=0;
    const source=prepareRegularGridQuery(models[2]);for(const [x,y] of [...points,[-32,-32],[-32,32],[32,-32],[32,32]]){const a=prepared.query(x,y),b=source.query(x,y);assert.ok(a&&b);max_height_m=Math.max(max_height_m,Math.abs(a.height-b.height));for(let k=0;k<2;k++)max_gradient=Math.max(max_gradient,Math.abs(a.gradient[k]-b.gradient[k]));}
    assert.ok(max_height_m<1e-9&&max_gradient<1e-9);const e=entries[i<2?0:i-1];methods.push({family:protocol.families[i],filename:e.binary_filename??e.filename,binary_bytes:e.binary_bytes??e.bytes,binary_sha256:e.binary_sha256??e.sha256,execution_points:prepared.execution_points??4225,stored_points:prepared.stored_points??4225,primitives:prepared.primitives??4096,prepare_ms,correctness:{requested:4100,hits:4100,max_height_m,max_gradient},query:prepared.query});}
  assert.equal(methods[0].execution_points,4225);assert.equal(methods[1].execution_points,8385);assert.equal(methods[2].execution_points,16641);
  for(let warm=0;warm<5;warm++)for(const m of methods)run(m.query,1);
  const calibration=methods.map(m=>stats(Array.from({length:3},()=>run(m.query,1).elapsed_ms)).median),loops=Math.max(1,Math.min(128,Math.ceil(30/Math.max(.001,Math.min(calibration[1],calibration[2]))))),rows=[];
  for(let trial=0;trial<orders.length;trial++)for(let position=0;position<4;position++){const m=methods[orders[trial][position]],r=run(m.query,loops),row={family:m.family,trial,execution_order:position,...r,ns_per_query:r.elapsed_ms*1e6/r.queries};rows.push(row);csv.push([c.id,row.family,trial,position,r.elapsed_ms,r.queries,row.ns_per_query,r.checksum].join(','));}
  for(let trial=0;trial<24;trial++){const group=rows.filter(r=>r.trial===trial),a=group[0].checksum;assert.ok(group.every(r=>Math.abs(r.checksum-a)<1e-8*Math.max(1,Math.abs(a))));}
  const summaries=methods.map(({query,...m})=>({...m,ns_per_query:stats(rows.filter(r=>r.family===m.family).map(r=>r.ns_per_query))}));
  const record={id:c.id,name:c.name,city_id:c.city_id,reference_sha256:c.reference_sha256,source_raster_sha256:c.source_raster_sha256,loops,queries_per_trial:4096*loops,calibration_ms_per_4096:calibration,methods:summaries,ratios:{p2_over_compact:summaries[2].ns_per_query.median/summaries[0].ns_per_query.median,generic_over_compact:summaries[1].ns_per_query.median/summaries[0].ns_per_query.median,grid_over_compact:summaries[3].ns_per_query.median/summaries[0].ns_per_query.median},rows};report.cases.push(record);
  console.log(c.id,'P2/compact',record.ratios.p2_over_compact.toFixed(3),'generic/compact',record.ratios.generic_over_compact.toFixed(3),'grid/compact',record.ratios.grid_over_compact.toFixed(3));
}
const csvRaw=Buffer.from(csv.join('\n')+'\n');await writeFile(folder+'/trials.csv',csvRaw);report.trials_csv={filename:'trials.csv',bytes:csvRaw.length,sha256:sha(csvRaw)};await writeFile(folder+'/results.json',JSON.stringify(report,null,2)+'\n');

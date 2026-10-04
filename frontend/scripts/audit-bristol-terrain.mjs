import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const out=root+'.local/benchmark/bristol-dtm-2026-10-05/';
await mkdir(out,{recursive:true});
await build({entryPoints:[root+'frontend/src/studio/terrainMath.ts'],outfile:out+'kernel.mjs',bundle:true,platform:'node',format:'esm'});
const {terrainIndex}=await import(pathToFileURL(out+'kernel.mjs').href);
const modelBytes=await readFile(root+'backend/data/terrain/bristol-ea-dtm-preview.gugis-terrain.json');
const terrain=JSON.parse(modelBytes),index=terrainIndex(terrain);
const source=JSON.parse(await readFile(root+'shared/public-terrain-sources.json'));
assert.equal(source.sources[0].model_sha256,hash(modelBytes));
const fixtureBytes=await readFile(process.argv[2]),fixtures=JSON.parse(fixtureBytes);
assert.equal(fixtures.length,4096);
const controls=terrain.points.map(([x,y,z])=>{const hit=index.query(x,y);assert.ok(hit);return Math.abs(hit.height-z);});
const results=fixtures.map(f=>({...f,hit:index.query(f.x,f.y)}));
const errors=results.filter(r=>r.hit).map(r=>r.hit.height-r.source_height_m);
const sorted=errors.map(Math.abs).sort((a,b)=>a-b);
const report={schema:'gugis-ea-bristol-preview-audit-v1',model_sha256:hash(modelBytes),
  raster_sha256:source.sources[0].raster_sha256,fixture_sha256:hash(fixtureBytes),
  native_kernel_sha256:hash((await readFile(root+'frontend/src/studio/terrainMath.ts','utf8')).replace(/\r\n/g,'\n')),
  scripts:{node:hash((await readFile(fileURLToPath(import.meta.url),'utf8')).replace(/\r\n/g,'\n')),
    python:hash((await readFile(root+'data-pipeline/audit_bristol_public_terrain.py','utf8')).replace(/\r\n/g,'\n'))},
  method:'4096 unique source 1m pixel centres; seed 20261005; 40-pixel rim excluded; website native kernel vs original pixel values; source participates in preview construction, not independent held-out ground truth',
  preview_stride_pixels:20,source_pixel_m:1,requested:fixtures.length,hits:errors.length,misses:fixtures.length-errors.length,
  rmse_m:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),mae_m:errors.reduce((s,e)=>s+Math.abs(e),0)/errors.length,
  p95_absolute_m:sorted[Math.ceil(.95*sorted.length)-1],max_absolute_m:Math.max(...sorted),
  controls_checked:controls.length,max_control_query_error_m:Math.max(...controls),
  limits:'Sampled relative raster differences only; no continuous bound, no actual-ground accuracy guarantee; no ArcGIS run; ODN heights unchanged'};
await writeFile(out+'report.json',JSON.stringify(report,null,2)+'\n');
await writeFile(out+'results.json',JSON.stringify(results)+'\n');
const fields=['row','column','x','y','source_height_m','native_height_m','difference_m'];
const csv=[fields.join(','),...results.map(r=>[r.row,r.column,r.x,r.y,r.source_height_m,r.hit?.height??'',r.hit?r.hit.height-r.source_height_m:''].join(','))].join('\n')+'\n';
await writeFile(out+'queries.csv',csv);
console.log(JSON.stringify(report,null,2));

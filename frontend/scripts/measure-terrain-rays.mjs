// Compare the frozen native full ray scan with candidate-filtered native rays.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=new URL('../../',import.meta.url),frontend=new URL('../',import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourceSha=async url=>sha((await readFile(url,'utf8')).replace(/\r\n/g,'\n'));
const output=new URL('.local/benchmark/terrain-rays-2026-10-05/',root);await mkdir(output,{recursive:true});
const bundle=new URL('node_modules/.cache/gugis-tests/terrain-rays-audit.mjs',frontend);
await build({stdin:{contents:"export {buildTerrainRayHierarchy} from './src/studio/terrainRayIndex'; export {terrainIndex} from './src/studio/terrainMath';",
  resolveDir:fileURLToPath(frontend)},outfile:fileURLToPath(bundle),bundle:true,platform:'node',format:'esm',packages:'external'});
const {buildTerrainRayHierarchy,terrainIndex}=await import(pathToFileURL(fileURLToPath(bundle)).href);
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const groups=[],parents={},records=[],fixtures={};
for(const name of ['strip-compaction-benchmark.json','raster-triangle-benchmark.json']){
  const raw=await readFile(new URL('shared/'+name,root));parents[name]=sha(raw);
  for(const c of JSON.parse(raw).cases){
    const v=c.variants.find(v=>v.target_m===.1),models=[];
    for(const family of name.startsWith('strip')?['compact_hybrid','local_triangles']:['hybrid','compact_hybrid','local_triangles']){
      const receipt=v[family],raw=await readFile(new URL(`public/research/hybrid-terrain/models/${c.id}/${receipt.filename}`,frontend));
      assert.equal(raw.length,receipt.bytes);assert.equal(sha(raw),receipt.sha256);
      models.push({family,receipt,terrain:JSON.parse(raw)});
    }
    groups.push({id:c.id,name:c.name,models});
  }
}
for(const group of groups){
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const {terrain} of group.models)for(const point of terrain.points)for(let i=0;i<3;i++){
    bounds[i]=Math.min(bounds[i],point[i]);bounds[i+3]=Math.max(bounds[i+3],point[i]);
  }
  let state=0x52415931;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const rayTop=bounds[5]+Math.max(20,bounds[5]-bounds[2]),rays=[];
  const point=()=>[bounds[0]+random()*(bounds[3]-bounds[0]),bounds[1]+random()*(bounds[4]-bounds[1])];
  for(let i=0;i<512;i++){const [x,y]=point();rays.push({origin:[x,y,rayTop],direction:[0,0,-1],kind:'vertical'});}
  for(let i=0;i<256;i++){
    const [x,y]=point(),dx=(random()-.5)*.7,dy=(random()-.5)*.7,distance=rayTop-(bounds[2]+bounds[5])/2;
    rays.push({origin:[x-dx*distance,y-dy*distance,rayTop],direction:[dx,dy,-1],kind:'oblique'});
  }
  for(let i=0;i<128;i++){
    const x=bounds[0]+(i%16)/15*(bounds[3]-bounds[0]),y=bounds[1]+Math.floor(i/16)/7*(bounds[4]-bounds[1]);
    rays.push({origin:[x,y,rayTop],direction:[0,0,-1],kind:'grid-and-boundary'});
  }
  for(let i=0;i<128;i++)rays.push({origin:[bounds[3]+10+i,bounds[4]+10,rayTop],direction:[0,0,1],kind:'miss'});
  assert.equal(rays.length,1024);
  fixtures[group.id]={bounds,rays};const fixtureSha=sha(JSON.stringify(rays));
  for(const {terrain,receipt,family} of group.models){
    const before=JSON.stringify(terrain);global.gc?.();
    let start=performance.now();const native=terrainIndex(terrain);const coreBuild=performance.now()-start;
    start=performance.now();const tree=buildTerrainRayHierarchy(terrain);const hierarchyBuild=performance.now()-start;
    const candidates=[],checks=[],nativeHits=[],filteredHits=[];let fallbacks=0;
    for(const ray of rays){
      const a=native.raycast(ray.origin,ray.direction),b=tree.raycastWithStats(ray.origin,ray.direction);
      assert.deepEqual(b.hit,a,'Filtered solver changed a native hit or boundary choice');
      nativeHits.push(a);filteredHits.push(b.hit);candidates.push(b.candidateCells);checks.push(b.nodesTested+b.cellsTested);
      if(b.fallback)fallbacks++;
    }
    const resultSha=sha(JSON.stringify(nativeHits));assert.equal(resultSha,sha(JSON.stringify(filteredHits)));
    for(const ray of rays.slice(0,16)){native.raycast(ray.origin,ray.direction);tree.raycast(ray.origin,ray.direction);}
    const times={linear:[],hierarchy:[]};
    for(let trial=0;trial<3;trial++)for(const mode of trial%2?['hierarchy','linear']:['linear','hierarchy']){
      global.gc?.();const index=mode==='linear'?native:tree;start=performance.now();
      for(const ray of rays)index.raycast(ray.origin,ray.direction);
      times[mode].push(performance.now()-start);
    }
    const linearMs=median(times.linear),hierarchyMs=median(times.hierarchy),perRaySaving=(linearMs-hierarchyMs)/1024;
    assert.equal(JSON.stringify(terrain),before);
    records.push({case_id:group.id,case_name:group.name,target_m:.1,family,filename:receipt.filename,archive_sha256:receipt.sha256,
      archive_bytes:receipt.bytes,fixture_sha256:fixtureSha,result_sha256:resultSha,rays:1024,hits:nativeHits.filter(Boolean).length,fallbacks,
      core_index_build_ms:coreBuild,hierarchy_extra_build_ms:hierarchyBuild,linear_batch_median_ms:linearMs,
      hierarchy_batch_median_ms:hierarchyMs,query_only_ratio:linearMs/hierarchyMs,
      approximate_build_break_even_rays:perRaySaving>0?Math.ceil(hierarchyBuild/perRaySaving):null,
      first_ray_estimate_ms:hierarchyBuild+hierarchyMs/1024,
      candidate_cells:{mean:candidates.reduce((a,b)=>a+b)/1024,max:Math.max(...candidates)},
      tested_boxes:{mean:checks.reduce((a,b)=>a+b)/1024,max:Math.max(...checks)},tree:tree.statistics});
  }
}
assert.equal(records.length,15);
const report={schema:'gugis-native-terrain-ray-audit-v1',generated_at:'2026-10-05',parents,
  sources:{hierarchy:await sourceSha(new URL('src/studio/terrainRayIndex.ts',frontend)),
    native_query:await sourceSha(new URL('src/studio/terrainMath.ts',frontend)),script:await sourceSha(new URL(import.meta.url))},
  runtime:{node:process.version,platform:process.platform,cpu:cpus()[0].model,logical_cpus:cpus().length,explicit_gc:!!global.gc},
  method:{samples:'1024 shared rays per terrain: 512 vertical, 256 oblique, 128 grid/boundary, 128 misses',
    timing:'Warm-up followed by 3 alternating query batches; median; GC, loading, hashing and equality audit excluded',
    equivalence:'Exact JS deep equality, including null/hit, patch ID, kind, height, slope, aspect, x/y and u/v; source order retained',
    build:'Additional hierarchy construction measured separately; amortization estimate is not interactive first-click latency',
    acceleration:'BVH boxes conservatively filter source cells; the frozen native solver selects the closest hit in original source order; more than 256 discovered candidates falls back to the original full scan',
    exclusions:'CPU native ray queries only; no GPU, browser FPS, ArcGIS run, DEM truth comparison or new height accuracy claim'},records};
await writeFile(new URL('report.json',output),JSON.stringify(report,null,2)+'\n');
await writeFile(new URL('ray-fixtures.json',output),JSON.stringify(fixtures)+'\n');
const columns=['case_id','family','archive_sha256','fixture_sha256','rays','hits','cells','linear_batch_median_ms','hierarchy_batch_median_ms','query_only_ratio','hierarchy_extra_build_ms','approximate_build_break_even_rays','mean_candidate_cells','max_candidate_cells'];
const csv=[columns.join(','),...records.map(r=>[r.case_id,r.family,r.archive_sha256,r.fixture_sha256,r.rays,r.hits,r.tree.cells,
  r.linear_batch_median_ms,r.hierarchy_batch_median_ms,r.query_only_ratio,r.hierarchy_extra_build_ms,r.approximate_build_break_even_rays??'',
  r.candidate_cells.mean,r.candidate_cells.max].join(','))].join('\n')+'\n';
await writeFile(new URL('report.csv',output),csv);
console.log(JSON.stringify({records:records.length,swiss:records.filter(r=>r.case_id==='swiss-dem-crop').map(r=>({family:r.family,
  cells:r.tree.cells,extra_build_ms:r.hierarchy_extra_build_ms,linear_batch_ms:r.linear_batch_median_ms,
  hierarchy_batch_ms:r.hierarchy_batch_median_ms,query_only_ratio:r.query_only_ratio,amortization_rays:r.approximate_build_break_even_rays,
  max_candidates:r.candidate_cells.max})),output:fileURLToPath(output)},null,2));

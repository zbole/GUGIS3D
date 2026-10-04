/** Query saved hybrid research models using the website's real native kernel. */
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const directory=resolve(process.argv[2]);
if(!global.gc)throw new Error('Run node --expose-gc for retained-index measurements');
const cache=fileURLToPath(new URL('../node_modules/.cache/gugis-examples/',import.meta.url));
await mkdir(cache,{recursive:true});const outfile=join(cache,'hybrid-query.mjs');
const source=fileURLToPath(new URL('../src/studio/terrainMath.ts',import.meta.url));
await build({entryPoints:[source],bundle:true,platform:'node',format:'esm',outfile});
const {terrainIndex}=await import(pathToFileURL(outfile).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report=JSON.parse(await readFile(join(directory,'results.json'))),records=[];
for(const data of report.cases){
  if(!/^[a-z-]+$/.test(data.id))throw new Error('Unexpected dataset name');
  const fixtureBytes=await readFile(join(directory,data.id,'query-fixture.json'));
  const fixture=JSON.parse(fixtureBytes);
  if(fixture.xy.length!==4096)throw new Error('Unexpected query count');
  const compact=['gugis-strip-compaction-research-v1','gugis-raster-triangle-research-v1'].includes(report.schema);
  const modes=compact?['hybrid','compact_hybrid','local_triangles']:report.schema==='gugis-local-triangle-research-v1'?['hybrid','local_triangles']:['hybrid','triangles'];
  for(const variant of data.variants)for(const mode of modes){
    const model=variant[mode];
    if(!/^(hybrid|triangles|paired-hybrid|local-triangles|compact-hybrid|raster-hybrid|raster-local-triangles|raster-compact-hybrid)-(0\.05|0\.1|0\.25|0\.5)m\.json$/.test(model.filename))throw new Error('Unexpected archive path');
    const content=await readFile(join(directory,data.id,model.filename));
    if(content.length!==model.bytes||sha(content)!==model.sha256)throw new Error('Saved archive changed');
    const terrain=JSON.parse(content);global.gc();const baseline=process.memoryUsage().heapUsed;
    const start=performance.now(),index=terrainIndex(terrain),index_ms=performance.now()-start;
    global.gc();const retained_index_heap_bytes=process.memoryUsage().heapUsed-baseline;
    const run=()=>fixture.xy.map(([x,y])=>index.query(x,y)?.height??null);
    run();const times=[];let values;
    for(let i=0;i<5;i++){const start=performance.now();values=run();times.push(performance.now()-start);}
    if(values.some(v=>v===null))throw new Error('Unexpected query hole');
    let preservation={};
    if(compact){
      if(!/^boundary-(0\.05|0\.1|0\.25|0\.5)m\.json$/.test(variant.boundary_fixture))throw new Error('Invalid boundary fixture path');
      const boundaryBytes=await readFile(join(directory,data.id,variant.boundary_fixture));
      if(sha(boundaryBytes)!==variant.boundary_fixture_sha256)throw new Error('Boundary fixture changed');
      const boundary=JSON.parse(boundaryBytes);
      if(boundary.xy.length>2048)throw new Error('Boundary query budget exceeded');
      const hits=sites=>sites.map(([x,y])=>{const hit=index.query(x,y);if(!hit)throw new Error('Preservation query hole');
        return {height:hit.height,slope:hit.slope,aspect:hit.aspect,kind:hit.kind};});
      preservation={hits:hits(fixture.xy),boundary_hits:hits(boundary.xy),boundary_fixture_sha256:sha(boundaryBytes)};
    }
    records.push({case:data.id,target_m:variant.target_m,mode,archive_sha256:sha(content),fixture_sha256:sha(fixtureBytes),
      index_ms,retained_index_heap_bytes,query_repetitions_ms:times,index_statistics:index.statistics,values,...preservation});
  }
  console.log(JSON.stringify({case:data.id,models:data.variants.length*modes.length,query_count:4096}));
}
await writeFile(join(directory,'native-query-results.json'),JSON.stringify({runtime:process.version,
  source_sha256:sha((await readFile(source,'utf8')).replace(/\r\n/g,'\n')),
  kernel:'frontend/src/studio/terrainMath.ts:terrainIndex.query',records}));

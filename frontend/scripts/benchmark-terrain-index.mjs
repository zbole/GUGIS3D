/** Paired native-kernel comparison. Separate processes isolate GC/retained heap.
 * No GPU, ArcGIS, training or cross-runtime speed claims. */
import {build} from 'esbuild';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import os from 'node:os';
const root = fileURLToPath(new URL('../../', import.meta.url));
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv[2] === '--child') {
  if (!global.gc) throw new Error('Run child with --expose-gc');
  const [moduleFile, archive, fixtureFile] = process.argv.slice(3);
  const {terrainIndex} = await import(pathToFileURL(moduleFile).href);
  const terrain = JSON.parse(await readFile(archive)), fixture = JSON.parse(await readFile(fixtureFile));
  global.gc(); const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now(), index = terrainIndex(terrain), index_ms = performance.now()-start;
  global.gc(); const retained_index_heap_bytes = process.memoryUsage().heapUsed - heapBefore;
  const run = () => fixture.query.map(([row,col])=>index.query(col*499.5,-row*499.5));
  run(); const times = []; let values;
  for (let i=0;i<9;i++) {const started=performance.now(); values=run(); times.push(performance.now()-started);}
  if (values.some(v=>!v)) throw new Error('Unexpected uncovered coordinate');
  // Include patch identity, inverse parameters and analytic derivatives, not just heights.
  console.log(JSON.stringify({index_ms,retained_index_heap_bytes,query_median_ms:median(times),
    query_repetitions_ms:times,result_sha256:sha(JSON.stringify(values)),statistics:index.statistics??null}));
} else {
  const directory = resolve(process.argv[2]), baseline = process.argv[3] ?? '56a008e';
  if (!/^[a-f0-9]{7,40}$/.test(baseline)) throw new Error('Baseline must be a commit SHA');
  const baselineCommit=execFileSync('git',['rev-parse',baseline],{cwd:root,encoding:'utf8'}).trim();
  const cache=join(root,'.local','benchmark','index-kernels'); await mkdir(cache,{recursive:true});
  const sourcePath=join(root,'frontend/src/studio/terrainMath.ts');
  const sources={before:Buffer.from(execFileSync('git',['show',`${baselineCommit}:frontend/src/studio/terrainMath.ts`],{cwd:root}).toString().replace(/\r\n/g,'\n')),
    after:Buffer.from((await readFile(sourcePath,'utf8')).replace(/\r\n/g,'\n'))};
  for (const [name,contents] of Object.entries(sources)) await build({stdin:{contents:contents.toString(),
    resolveDir:dirname(sourcePath),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:join(cache,`${name}.mjs`)});
  const fixture=join(directory,'query-fixture.json'), reports=[];
  const coordinates=JSON.parse(await readFile(fixture)).query;
  if (!Array.isArray(coordinates) || coordinates.length!==4096 || coordinates.some(pair=>
    !Array.isArray(pair) || pair.length!==2 || pair.some(v=>!Number.isFinite(v)||Math.abs(v)>1)))
    throw new Error('Expected the 4096 shared normalized query coordinates');
  const precisionReport=JSON.parse(await readFile(join(root,'shared/implicit-terrain-benchmark.json')));
  for (const stride of [2,4,8,16,32,64]) {
    const archive=join(directory,`gugis-${stride}m.json`), trials={before:[],after:[]};
    const archiveHash=sha(await readFile(archive));
    if (archiveHash!==precisionReport.variants.find(v=>v.stride_m===stride)?.sha256)
      throw new Error(`Archive differs from the published precision experiment: ${stride}m`);
    for (let trial=0;trial<3;trial++) for (const name of trial%2 ? ['after','before'] : ['before','after']) {
      const output=execFileSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--child',
        join(cache,`${name}.mjs`),archive,fixture],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
      trials[name].push(JSON.parse(output));
    }
    const hashes=[...trials.before,...trials.after].map(v=>v.result_sha256);
    if (new Set(hashes).size!==1) throw new Error(`Kernel results differ: ${stride}m`);
    const summarize=name=>({query_median_ms:median(trials[name].map(v=>v.query_median_ms)),
      index_median_ms:median(trials[name].map(v=>v.index_ms)),
      retained_index_heap_bytes:median(trials[name].map(v=>v.retained_index_heap_bytes)),
      statistics:trials[name][0].statistics,trials:trials[name]});
    const before=summarize('before'),after=summarize('after');
    const row={id:`gugis-${stride}m`,stride_m:stride,archive_sha256:archiveHash,before,after,
      speedup:before.query_median_ms/after.query_median_ms,
      results_identical:true,result_sha256:hashes[0]};reports.push(row);
    console.log(JSON.stringify({id:row.id,before_ms:before.query_median_ms,after_ms:after.query_median_ms,
      speedup:row.speedup,before_heap:before.retained_index_heap_bytes,after_heap:after.retained_index_heap_bytes}));
  }
  const report={schema:'gugis-native-index-benchmark-v1',generated_at:new Date().toISOString(),
    baseline_commit:baselineCommit,source_sha256:{before:sha(sources.before),after:sha(sources.after)},
    fixture_sha256:sha(await readFile(fixture)),query_count:4096,
    method:'Three fresh processes per kernel/variant, alternating order; one warm-up and nine query runs per process. Median of per-process medians. Exact serialized TerrainHit hashes include height, slope, aspect, patch and parameters. Retained V8 heap after forced GC above parsed-terrain baseline; excludes GPU and browser. Raycast unchanged. No cross-runtime or ArcGIS speed claim.',
    runtime:{node:process.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model},reports};
  await writeFile(join(root,'shared/terrain-index-benchmark.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(root,'frontend/public/research/implicit-terrain/terrain-index-benchmark.json'),JSON.stringify(report,null,2)+'\n');
}

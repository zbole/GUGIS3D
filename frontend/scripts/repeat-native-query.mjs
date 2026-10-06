import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {adaptFrozenRunner,sha} from './nativeRepeatAdapter.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=process.argv[2],pieces=process.argv[3];
if(!output||!pieces)throw Error('Provide fresh private output directory and original fixed piecewise fixture directory');
const folder=path.resolve(output),parent=await realpath(path.dirname(folder)),workspace=await realpath(root),relative=path.relative(workspace,parent);
if(relative!==path.join('.local','research'))throw Error('Output must be a direct fresh child of this repository .local/research');
const source=path.resolve(pieces),protocolRaw=await readFile(root+'data-pipeline/native_query_repeat_protocol.json'),protocol=JSON.parse(protocolRaw),baseline=await readFile(root+'frontend/public/research/native-query-v1/results.json'),baselineReport=JSON.parse(baseline);
assert.equal(sha(baseline),protocol.baseline_report_sha256);assert.equal(sha(await readFile(source+'/results.json')),protocol.piecewise_report_sha256);
for(const [p,h] of Object.entries(baselineReport.scripts))assert.equal(sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n')),h);
const runner=adaptFrozenRunner(await readFile(root+'frontend/scripts/benchmark-order-query.mjs','utf8'),root,pathToFileURL(root+'frontend/tests/bundleWorkspaceModule.mjs').href,protocol.frozen_runner_sha256_lf);
await mkdir(folder,{recursive:false});await writeFile(folder+'/protocol.json',protocolRaw);await writeFile(folder+'/replay-runner.mjs',runner);
const scripts={};for(const p of ['frontend/scripts/repeat-native-query.mjs','frontend/scripts/nativeRepeatAdapter.mjs','frontend/tests/bundleWorkspaceModule.mjs'])scripts[p]=sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n'));
const receipt={schema:'gugis-native-query-repeat-v1',generated_utc:new Date().toISOString(),protocol_sha256:sha(protocolRaw),baseline_report_sha256:sha(baseline),adapted_runner_sha256:sha(runner),scripts,runs:[],scope:protocol.scope};
await writeFile(folder+'/run-receipt.json',JSON.stringify(receipt,null,2)+'\n');
for(let i=1;i<=protocol.repetitions;i++){
  const output=path.join(folder,`run-${i}`);console.log(`Fresh Node repetition ${i}/${protocol.repetitions}`);
  const status=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[folder+'/replay-runner.mjs',output,source],{cwd:workspace,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
  const row={repetition:i,folder:`run-${i}`,exit_code:status.code,signal:status.signal};
  if(status.code===0){const raw=await readFile(output+'/results.json'),report=JSON.parse(raw);assert.deepEqual(report.cases.map(c=>c.id),protocol.cases);row.report_sha256=sha(raw);row.trials_sha256=report.trials_csv.sha256;}
  receipt.runs.push(row);await writeFile(folder+'/run-receipt.json',JSON.stringify(receipt,null,2)+'\n');
  if(status.code!==0)throw Error(`Repetition ${i} failed; completed/failed runs retained without retries`);
}
console.log('All fixed repetitions retained; original evidence unchanged.');

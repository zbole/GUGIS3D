import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adaptFrozenRunner,sha} from '../scripts/nativeRepeatAdapter.mjs';
const frozen=await readFile(new URL('../scripts/benchmark-order-query.mjs',import.meta.url),'utf8'),protocol=JSON.parse(await readFile(new URL('../../data-pipeline/native_query_repeat_protocol.json',import.meta.url)));
test('repeat adapter retains the exact timed body, calibration, correctness loops and five-case generation of the frozen runner',()=>{
  const result=adaptFrozenRunner(frozen,'C:/workspace/','file:///C:/workspace/frontend/tests/bundleWorkspaceModule.mjs',protocol.frozen_runner_sha256_lf);
  const normalized=frozen.replace(/\r\n/g,'\n');assert.ok(result.includes("const build=async options=>bundleWorkspaceModule(options.entryPoints[0],options.outfile);"));assert.ok(!result.includes("from 'esbuild'"));assert.equal(result.slice(result.indexOf('const points=[];')),normalized.slice(normalized.indexOf('const points=[];')));assert.equal(sha(normalized),protocol.frozen_runner_sha256_lf);
});
test('changed frozen source is rejected rather than silently altering the benchmark',()=>{
  assert.throws(()=>adaptFrozenRunner(frozen.replace('prepared_trials:17','prepared_trials:18'),'C:/workspace/','file:///builder.mjs',protocol.frozen_runner_sha256_lf),/Frozen timing source changed/);
});

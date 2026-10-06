import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
// The complete timed body stays byte-for-byte equal to the original runner.
// An explicit workspace builder avoids ancestor-directory package probing.
export function adaptFrozenRunner(raw,root,builderURL,expected){
  const frozen=raw.replace(/\r\n/g,'\n');assert.equal(sha(frozen),expected,'Frozen timing source changed');
  const importLine="import {build} from 'esbuild';",rootExpression="fileURLToPath(new URL('../../',import.meta.url))";
  assert.equal(frozen.split(importLine).length,2);assert.equal(frozen.split(rootExpression).length,2);
  const adapter=`import {bundleWorkspaceModule} from ${JSON.stringify(builderURL)};\nconst build=async options=>bundleWorkspaceModule(options.entryPoints[0],options.outfile);`;
  const result=frozen.replace(importLine,adapter).replace(rootExpression,JSON.stringify(root));
  assert.equal(result.replace(adapter,importLine).replace(JSON.stringify(root),rootExpression),frozen,'Adapter changed timed source');
  return result;
}

import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=process.argv[2],sha=b=>createHash('sha256').update(b).digest('hex');if(!folder)throw new Error('Provide fresh private directory');
await mkdir(folder,{recursive:false});const protocol=await readFile(root+'data-pipeline/source_query_protocol.json'),p=JSON.parse(protocol);await writeFile(folder+'/protocol.json',protocol);
const source=await readFile(root+'shared/source-native-bands-v1.json');assert.equal(sha(source),p.source_publication_sha256);
const scripts={};for(const filename of ['frontend/scripts/repeat-source-query.mjs','frontend/scripts/benchmark-source-query.mjs','frontend/tests/bundleWorkspaceModule.mjs','frontend/src/compare/compactSourceBandQuery.ts','frontend/src/compare/sourceRuledBandMath.ts','frontend/src/compare/principalRuledMath.ts'])scripts[filename]=sha((await readFile(root+filename,'utf8')).replace(/\r\n/g,'\n'));
const receipt={schema:'gugis-source-query-receipt-v1',started_utc:new Date().toISOString(),protocol_sha256:sha(protocol),source_publication_sha256:sha(source),scripts,runs:[]};await writeFile(folder+'/run-receipt.json',JSON.stringify(receipt,null,2)+'\n');
for(let repetition=1;repetition<=p.repetitions;repetition++){
  const name=`run-${repetition}`,started_utc=new Date().toISOString();console.log('Starting fresh source-query process',repetition);
  const status=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[root+'frontend/scripts/benchmark-source-query.mjs',folder+'/'+name,folder+'/protocol.json'],{cwd:root+'frontend',stdio:'inherit'});child.on('error',reject);child.on('exit',(exit_code,signal)=>resolve({exit_code,signal}));});
  const entry={repetition,folder:name,started_utc,finished_utc:new Date().toISOString(),...status};receipt.runs.push(entry);
  if(status.exit_code===0){entry.report_sha256=sha(await readFile(folder+'/'+name+'/results.json'));entry.trials_sha256=sha(await readFile(folder+'/'+name+'/trials.csv'));}
  await writeFile(folder+'/run-receipt.json',JSON.stringify(receipt,null,2)+'\n');if(status.exit_code!==0||status.signal)throw new Error('Process failed; retained receipt, no automatic restart');
}
console.log('All three fresh-process source-query runs retained');

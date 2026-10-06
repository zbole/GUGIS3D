import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from '../tests/bundleWorkspaceModule.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
if(path.dirname(folder)!==path.join(root,'.local','research'))throw Error('Fresh direct repository private output required');await mkdir(folder);
const release=JSON.parse(await readFile(root+'shared/paper-projection-display-v1.json')),base=root+'frontend/public/research/paper-projection-stable-v1/prototype/',raw=await readFile(base+'results.json');assert.equal(sha(raw),release.prototype_report_sha256);const report=JSON.parse(raw),models=[],byId=new Map(),pairs=[];
const out=folder+'/prototype-audit-kernel.mjs';await bundleWorkspaceModule(root+'frontend/src/compare/principalRuledMath.ts',out);const {decodePrincipalBinary,encodePrincipalBinary}=await import(pathToFileURL(out).href);
for(const site of report.cases)for(const row of site.pairs){const record={case_id:site.id,budget:row.budget};for(const family of ['pt','c0-l2']){const e=row[family],key=site.id+'/'+e.filename;if(!byId.has(key)){
  const jr=await readFile(base+key),br=await readFile(base+site.id+'/'+e.binary_filename);assert.equal(sha(jr),e.sha256);assert.equal(jr.length,e.bytes);assert.equal(sha(br),e.binary_sha256);assert.equal(br.length,e.binary_bytes);const saved=JSON.parse(jr);let decoded,error;
  try{decoded=decodePrincipalBinary(br);}catch(e){error=e.message;assert.match(error,/^Invalid principal-surface protocol or capacity$/);}
  const maximum=Math.max(...saved.points.flat().map(Math.abs));assert.equal(!!error,maximum>10000);if(decoded){assert.deepEqual(decoded,saved);assert.equal(sha(Buffer.from(encodePrincipalBinary(decoded))),e.binary_sha256);}
  const entry={case_id:site.id,filename:e.filename,binary_filename:e.binary_filename,binary_sha256:e.binary_sha256,method:family,native_valid:!error,native_rejection:error??null,maximum_abs_stored_coordinate_or_coefficient_m:maximum};models.push(entry);byId.set(key,entry);
}record[family]=byId.get(key).native_valid;}record.prototype_error_worsened=row['c0-l2'].e2_m2>row.prior.mean_hessian.e2_m2;pairs.push(record);}
const scripts={};for(const p of ['frontend/scripts/audit-projection-prototype.mjs','frontend/tests/bundleWorkspaceModule.mjs','frontend/src/compare/principalRuledMath.ts','frontend/src/compare/curvedRuledMath.ts','frontend/src/compare/terrainOrderMath.ts','frontend/src/compare/preparedOrderQuery.ts'])scripts[p]=sha((await readFile(root+p,'utf8')).replace(/\r\n/g,'\n'));
const audit={schema:'gugis-projection-prototype-native-audit-v1',parent_report_sha256:release.report_sha256,prototype_report_sha256:sha(raw),parent_package:release.package,scripts,native_models:models.length,valid_models:models.filter(e=>e.native_valid).length,rejected_models:models.filter(e=>!e.native_valid).length,pairs,rejected_pairs:pairs.filter(p=>!p.pt||!p['c0-l2']).length,source_error_worsened_pairs:pairs.filter(p=>p.prototype_error_worsened).length,models};await writeFile(folder+'/results.json',JSON.stringify(audit,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({native_models:audit.native_models,rejected_models:audit.rejected_models,rejected_pairs:audit.rejected_pairs,worse_error_pairs:audit.source_error_worsened_pairs}));

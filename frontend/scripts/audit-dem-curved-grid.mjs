import {readFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const folder=process.argv[2],root=fileURLToPath(new URL('../../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(folder+'/results.json'),report=JSON.parse(raw);assert.equal(report.schema,'gugis-dem-curved-grid-v1');
await assert.rejects(access(folder+'/native-audit.json'),{code:'ENOENT'});
const {validateCurveModel,curveQuery}=await import(pathToFileURL(root+'frontend/src/compare/curvedRuledMath.ts').href);
const source=(ref,x,y)=>{const i=Math.min(63,Math.max(0,Math.floor(x+32))),j=Math.min(63,Math.max(0,Math.floor(y+32))),u=x+32-i,v=y+32-j,z=ref.height;return (1-u)*(1-v)*z[j][i]+u*(1-v)*z[j][i+1]+(1-u)*v*z[j+1][i]+u*v*z[j+1][i+1];};
const rows=[];
for(const c of report.cases){
  const refRaw=await readFile(`${folder}/${c.id}/reference.json`);assert.equal(sha(refRaw),c.reference_sha256);const ref=JSON.parse(refRaw),seen=new Set();
  const entries=[];
  for(const p of c.pairs){entries.push({...p.baseline,kind:'P1'});for(const id of [p.best_e2_at_file_ceiling,p.best_e2_with_maximum_gate])if(id&&!seen.has(id)){seen.add(id);entries.push({...c.candidates.find(e=>e.id===id),filename:id+'.json',kind:'P2xP1'});}}
  for(const e of entries){
    const b=await readFile(`${folder}/${c.id}/${e.filename}`);assert.equal(b.length,e.bytes);assert.equal(sha(b),e.sha256);const model=validateCurveModel(JSON.parse(b));
    let max=0,squares=0,hits=0;
    for(let i=0;i<16;i++)for(let j=0;j<32;j++){
      const x=-32+(i+.38196601125)*64/16,y=-32+(j+.61803398875)*64/32,q=curveQuery(model,x,y);assert.ok(q);hits++;
      const error=q.height-source(ref,x,y);max=Math.max(max,Math.abs(error));squares+=error*error;
    }
    assert.ok(max<=e.continuous_bound_m+1e-9);
    let witness_checked=false;
    if(e.maximum_witness){const w=e.maximum_witness,q=curveQuery(model,w.x,w.y);assert.ok(q);assert.ok(Math.abs(Math.abs(q.height-source(ref,w.x,w.y))-w.absolute_error_m)<1e-9);witness_checked=true;}
    rows.push({case_id:c.id,filename:e.filename,sha256:e.sha256,bytes:e.bytes,kind:e.kind,requested:512,hits,sampled_maximum_m:max,sampled_rmse_m:Math.sqrt(squares/hits),maximum_witness_checked:witness_checked});
  }
  console.log(c.id+' native functions, coverage and extrema witnesses verified');
}
const audit={schema:'gugis-dem-curved-grid-native-v1',report_sha256:sha(raw),auditor_sha256:sha((await readFile(root+'frontend/scripts/audit-dem-curved-grid.mjs','utf8')).replace(/\r\n/g,'\n')),
  kernel_sha256:sha((await readFile(root+'frontend/src/compare/curvedRuledMath.ts','utf8')).replace(/\r\n/g,'\n')),
  fixture:'16x32 fixed off-fit interior coordinates per retained model; sampled errors do not replace whole-domain E2 or extrema calculation.',rows};
await writeFile(folder+'/native-audit.json',JSON.stringify(audit,null,2)+'\n');

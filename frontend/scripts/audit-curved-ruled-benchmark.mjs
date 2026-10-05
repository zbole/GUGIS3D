import {readFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const folder=process.argv[2],root=fileURLToPath(new URL('../../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(folder+'/results.json'),report=JSON.parse(bytes);
assert.equal(report.schema,'gugis-curved-ruled-comparison-v1');
await assert.rejects(access(folder+'/native-audit.json'),{code:'ENOENT'});
await build({entryPoints:[root+'frontend/src/compare/curvedRuledMath.ts'],outfile:folder+'/native-kernel.mjs',bundle:true,format:'esm',platform:'node'});
const {curveQuery,validateCurveModel}=await import(pathToFileURL(folder+'/native-kernel.mjs').href);
const field=(c,x,y)=>c.polynomial?30+c.polynomial.quadratic[0]*x*x+c.polynomial.quadratic[1]*y*y+c.polynomial.quartic[0]*x**4+c.polynomial.quartic[1]*y**4:
  30+c.q_matrix[0][0]*x*x+2*c.q_matrix[0][1]*x*y+c.q_matrix[1][1]*y*y;
const rows=[];
for(const c of report.cases){
  for(const entry of [...c.baselines,...c.candidates]){
    const b=await readFile(`${folder}/${c.id}/${entry.filename}`);assert.equal(b.length,entry.bytes);assert.equal(sha(b),entry.sha256);
    const model=validateCurveModel(JSON.parse(b)),errors=[];
    for(let i=0;i<64;i++)for(let j=0;j<64;j++){
      const x=-50+(i+.38196601125)*100/64,y=-50+(j+.61803398875)*100/64;
      const q=curveQuery(model,x,y);assert.ok(q);errors.push(q.height-field(c,x,y));
    }
    const max=Math.max(...errors.map(Math.abs));assert.ok(max<=entry.continuous_bound_m+1e-8);
    // Bezier midpoint controls are shape controls, not interpolation samples.
    let interpolationChecks=0,maxInterpolationError=0,maxQueryControlDifference=0;
    if(entry.axis){
      for(const patch of model.patches)for(const v of [0,1])for(const u of [0,.5,1]){
        const a=model.points[patch.left[0]],b=model.points[patch.right[0]],end=model.points[patch.left[2]],axis=entry.axis==='x'?0:1;
        const xy=[0,0];xy[axis]=a[axis]+u*(end[axis]-a[axis]);xy[1-axis]=a[1-axis]+v*(b[1-axis]-a[1-axis]);
        const q=curveQuery(model,...xy);assert.ok(q);const error=Math.abs(q.height-field(c,...xy));maxInterpolationError=Math.max(maxInterpolationError,error);interpolationChecks++;
      }
    }else for(const [x,y,z] of model.points){
      // Paper baseline is intentionally nonconforming. A hanging vertex can
      // lie on another coarse edge, whose first-hit height need not equal z.
      // Verify its own stored interpolation value and disclose the mismatch.
      const q=curveQuery(model,x,y);assert.ok(q);
      maxInterpolationError=Math.max(maxInterpolationError,Math.abs(z-field(c,x,y)));
      maxQueryControlDifference=Math.max(maxQueryControlDifference,Math.abs(q.height-z));interpolationChecks++;
    }
    assert.ok(maxInterpolationError<1e-8);
    rows.push({case:c.id,filename:entry.filename,model_sha256:entry.sha256,hits:4096,requested:4096,
      sampled_rmse_m:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/4096),sampled_max_m:max,interpolation_checks:interpolationChecks,
      max_interpolation_error_m:maxInterpolationError,max_first_hit_control_difference_m:maxQueryControlDifference});
  }
  console.log(c.id,'all native controls and 4096-point probes verified');
}
await writeFile(folder+'/native-audit.json',JSON.stringify({schema:'gugis-curved-ruled-native-audit-v1',parent_report_sha256:sha(bytes),
  auditor_sha256:sha((await readFile(fileURLToPath(import.meta.url),'utf8')).replace(/\r\n/g,'\n')),
  kernel_sha256:sha((await readFile(root+'frontend/src/compare/curvedRuledMath.ts','utf8')).replace(/\r\n/g,'\n')),
  fixture:'64x64 deterministic interior product; fractions .38196601125 and .61803398875, independently off fit samples. Sampled errors do not replace full-domain E2.',rows},null,2)+'\n');

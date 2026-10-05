import {readFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const folder=process.argv[2],root=fileURLToPath(new URL('../../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(folder+'/results.json'),report=JSON.parse(raw);assert.equal(report.schema,'gugis-terrain-order-control-v1');
await assert.rejects(access(folder+'/native-audit.json'),{code:'ENOENT'});
await build({entryPoints:[root+'frontend/src/compare/terrainOrderMath.ts'],outfile:folder+'/native-order-kernel.mjs',bundle:true,format:'esm',platform:'node'});
const {validateOrderModel,decodeOrderBinary,orderQuery,lagrangeBasis,nodeOrders}=await import(pathToFileURL(folder+'/native-order-kernel.mjs').href);
const field=(c,x,y)=>c.polynomial?30+.0001*(x*x+y*y)+5e-7*x**4+8e-8*y**4:c.q_matrix?30+c.q_matrix[0][0]*x*x+2*c.q_matrix[0][1]*x*y+c.q_matrix[1][1]*y*y:
  c.id==='extruded-quadratic'?30+.002*x*x+.03*y:30+.00002*x*x*(y+60)+.01*y;
const rows=[];
for(const c of [...report.cases,...report.structure_fixtures]){
  const entries=c.p2_models?[...c.p2_models,...c.ruled_references]:[c.ruled,c.triangles];
  for(const e of entries){
    const bytes=await readFile(`${folder}/${c.id}/${e.filename}`),binary=await readFile(`${folder}/${c.id}/${e.binary_filename}`);
    assert.equal(bytes.length,e.bytes);assert.equal(sha(bytes),e.sha256);assert.equal(binary.length,e.binary_bytes);assert.equal(sha(binary),e.binary_sha256);
    const model=validateOrderModel(JSON.parse(bytes)),decoded=decodeOrderBinary(binary);assert.deepEqual(decoded,model);
    let sum=0,max=0,hits=0,gradientMax=0;
    for(let i=0;i<64;i++)for(let j=0;j<64;j++){
      const x=-50+(i+.38196601125)*100/64,y=-50+(j+.61803398875)*100/64;
      const a=orderQuery(model,x,y),b=orderQuery(decoded,x,y);assert.ok(a);assert.deepEqual(a,b);hits++;
      const error=a.height-field(c,x,y);sum+=error*error;max=Math.max(max,Math.abs(error));
      if(c.q_matrix){
        const q=c.q_matrix,expected=[2*q[0][0]*x+2*q[0][1]*y,2*q[0][1]*x+2*q[1][1]*y];
        if(model.patches[0].kind==='lagrange-triangle')for(let k=0;k<2;k++)gradientMax=Math.max(gradientMax,Math.abs(a.gradient[k]-expected[k]));
      }
      if(c.both_numerically_exact){
        const expected=c.id==='extruded-quadratic'?[.004*x,.03]:[.00004*x*(y+60),.00002*x*x+.01];
        for(let k=0;k<2;k++)gradientMax=Math.max(gradientMax,Math.abs(a.gradient[k]-expected[k]));
      }
    }
    if(model.patches[0].kind==='lagrange-triangle'&&c.q_matrix){assert.ok(max<1e-9);assert.ok(gradientMax<1e-9);}
    if(c.both_numerically_exact){assert.ok(max<1e-9);assert.ok(gradientMax<1e-9);}
    let nodalChecks=0,nodalMax=0;
    if(model.patches[0].kind==='lagrange-triangle')for(const p of model.patches){
      const orders=nodeOrders(p.degree);
      for(let i=0;i<orders.length;i++){
        const basis=lagrangeBasis(orders[i].map(n=>n/p.degree),p.degree);
        const height=basis.reduce((z,b,j)=>z+b.value*model.points[p.nodes[j]][2],0);
        nodalMax=Math.max(nodalMax,Math.abs(height-model.points[p.nodes[i]][2]));nodalChecks++;
      }
    }
    assert.ok(nodalMax<1e-9);
    rows.push({case:c.id,filename:e.filename,model_sha256:e.sha256,binary_sha256:e.binary_sha256,requested:4096,hits,sampled_rmse_m:Math.sqrt(sum/hits),sampled_max_m:max,
      quadratic_gradient_max_difference:gradientMax,nodal_checks:nodalChecks,nodal_interpolation_max_m:nodalMax,binary_queries_identical:true});
  }
  console.log(c.id+' native JSON / full binary / 4096 queries verified');
}
const audit={schema:'gugis-terrain-order-native-audit-v1',parent_report_sha256:sha(raw),auditor_sha256:sha((await readFile(root+'frontend/scripts/audit-terrain-order-control.mjs','utf8')).replaceAll('\r\n','\n')),
  kernel_sha256:sha((await readFile(root+'frontend/src/compare/terrainOrderMath.ts','utf8')).replaceAll('\r\n','\n')),
  curve_kernel_sha256:sha((await readFile(root+'frontend/src/compare/curvedRuledMath.ts','utf8')).replaceAll('\r\n','\n')),
  fixture:'64x64 deterministic off-fit interior queries; JSON and entire GOC2 binary return identical results. Sampled maxima do not replace full-domain E2.',rows};
await writeFile(folder+'/native-audit.json',JSON.stringify(audit,null,2)+'\n');

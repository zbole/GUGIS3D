import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
const f=p=>new URL(p,import.meta.url);
const output=fileURLToPath(f('../node_modules/.cache/gugis-tests/prepared-order-query.mjs'));
await build({entryPoints:[fileURLToPath(f('../src/compare/preparedOrderQuery.ts'))],outfile:output,bundle:true,platform:'node',format:'esm'});
const {prepareOrderQuery}=await import(pathToFileURL(output).href);
const originalOutput=fileURLToPath(f('../node_modules/.cache/gugis-tests/prepared-order-original.mjs'));
await build({entryPoints:[fileURLToPath(f('../src/compare/terrainOrderMath.ts'))],outfile:originalOutput,bundle:true,platform:'node',format:'esm'});
const {orderQuery,nodeOrders}=await import(pathToFileURL(originalOutput).href);
const report=JSON.parse(await readFile(f('../../shared/terrain-order-control-v1.json')));

test('prepared kernels preserve frozen heights, gradients, first-hit ownership and model bytes across all 86 published functions',async()=>{
  let count=0;
  for(const c of [...report.cases,...report.structure_fixtures]){
    const entries=c.p2_models?[...c.p2_models,...c.ruled_references]:[c.ruled,c.triangles];
    for(const e of entries){
      const model=JSON.parse(await readFile(f(`../public/research/order-controls-v1/${c.id}/${e.filename}`)));
      const before=JSON.stringify(model),prepared=prepareOrderQuery(model);count++;
      const xy=[[-50,-50],[-50,50],[50,-50],[50,50],[0,0]];
      for(let i=0;i<16;i++)for(let j=0;j<8;j++)xy.push([-50+(i+.381966)*100/16,-50+(j+.618034)*100/8]);
      for(const [x,y] of xy){const a=orderQuery(model,x,y),b=prepared.query(x,y);assert.ok(a);assert.ok(b);
        assert.equal(a.patch,b.patch);assert.equal(a.kind,b.kind);
        assert.ok(Math.abs(a.height-b.height)<1e-9,`${c.id}/${e.filename} height`);
        for(let k=0;k<2;k++)assert.ok(Math.abs(a.gradient[k]-b.gradient[k])<1e-9,`${c.id}/${e.filename} gradient`);
      }
      for(const xy of [[50.1,0],[0,-50.1],[NaN,0],[0,Infinity]])assert.equal(prepared.query(...xy),null);
      assert.equal(JSON.stringify(model),before);
    }
  }
  assert.equal(count,86);
});

test('compiled P2/P3 nodal functions reproduce independent Cartesian polynomials on a rotated non-unit triangle',()=>{
  const a=[-12,-5],b=[30,7],c=[-8,24];
  for(const degree of [2,3]){
    const q=[30,.02,-.01,.0003,.00007,.0004,...(degree===3?[1e-6,-3e-7,-4e-7,3e-7]:[0,0,0,0])];
    const field=(x,y)=>q[0]+q[1]*x+q[2]*y+q[3]*x*x+q[4]*x*y+q[5]*y*y+q[6]*x**3+q[7]*x*x*y+q[8]*x*y*y+q[9]*y**3;
    const gradient=(x,y)=>[q[1]+2*q[3]*x+q[4]*y+3*q[6]*x*x+2*q[7]*x*y+q[8]*y*y,q[2]+q[4]*x+2*q[5]*y+q[7]*x*x+2*q[8]*x*y+3*q[9]*y*y];
    const points=nodeOrders(degree).map(alpha=>{const x=(alpha[0]*a[0]+alpha[1]*b[0]+alpha[2]*c[0])/degree,y=(alpha[0]*a[1]+alpha[1]*b[1]+alpha[2]*c[1])/degree;return [x,y,field(x,y)];});
    const model={format:'gugis-research-surface',version:2,coordinate_system:'LOCAL_METERS',points,patches:[{kind:'lagrange-triangle',degree,nodes:points.map((_,i)=>i)}]};
    const prepared=prepareOrderQuery(model);
    for(let i=0;i<=16;i++)for(let j=0;j<=16-i;j++){
      const u=i/16,v=j/16,x=a[0]+u*(b[0]-a[0])+v*(c[0]-a[0]),y=a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]);
      const hit=prepared.query(x,y);assert.ok(hit);assert.ok(Math.abs(hit.height-field(x,y))<1e-9);
      const g=gradient(x,y);for(let k=0;k<2;k++)assert.ok(Math.abs(hit.gradient[k]-g[k])<1e-10);
    }
  }
});

test('both orientations of a quadratic ruled patch preserve independent gradients and decline malformed inputs',()=>{
  for(const along of [0,1]){
    const p=(u,v,z)=>along===0?[u,v,z]:[v,u,z];
    const model={format:'gugis-research-surface',version:2,coordinate_system:'LOCAL_METERS',
      points:[p(0,0,4),p(2,0,-4),p(4,0,4),p(0,3,7),p(2,3,-1),p(4,3,7)],patches:[{kind:'quadratic-ruled',left:[0,1,2],right:[3,4,5]}]};
    const prepared=prepareOrderQuery(model);
    for(let i=0;i<=16;i++)for(let j=0;j<=16;j++){
      const u=i/4,v=3*j/16,xy=p(u,v,0),q=prepared.query(xy[0],xy[1]);assert.ok(q);
      assert.ok(Math.abs(q.height-((u-2)**2+v))<1e-12);
      assert.ok(Math.abs(q.gradient[along]-2*(u-2))<1e-12);assert.ok(Math.abs(q.gradient[1-along]-1)<1e-12);
    }
    const wrong=structuredClone(model);wrong.points[1][along]+=.1;
    assert.throws(()=>prepareOrderQuery(wrong),/非折叠/);
  }
});

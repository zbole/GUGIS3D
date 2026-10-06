import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePrincipalQuery,validatePrincipalModel,encodePrincipalBinary,decodePrincipalBinary} from '../src/compare/principalRuledMath.ts';
const f=(u,v)=>30+2*u*u+.3*u+v*(.2+.4*u+.1*u*u);
function surface(angle,sign=1){
  const t=angle*Math.PI/180,e=[20*Math.cos(t),20*Math.sin(t)],d=[-sign*12*Math.sin(t),sign*12*Math.cos(t)],origin=[-10,-10],points=[];
  for(const v of [0,1]){const z=[0,.5,1].map(u=>f(u,v));z[1]=2*z[1]-(z[0]+z[2])/2;for(let i=0;i<3;i++)points.push([origin[0]+e[0]*i/2+d[0]*v,origin[1]+e[1]*i/2+d[1]*v,z[i]]);}
  return {m:{format:'gugis-research-surface',version:3,coordinate_system:'LOCAL_METERS',clip_bounds:[-50,-50,50,50],points,patches:[{kind:'quadratic-ruled',left:[0,1,2],right:[3,4,5]}]},e,d,origin};
}
test('arbitrarily rotated and reflected ruled projections retain height and Cartesian gradients',()=>{
  for(const angle of [0,30,-23,90,135])for(const sign of [1,-1]){
    const {m,e,d,origin}=surface(angle,sign),q=preparePrincipalQuery(m),det=e[0]*d[1]-e[1]*d[0];
    for(const u of [0,.137,.5,.881,1])for(const v of [0,.249,.618,1]){
      const a=q.query(origin[0]+u*e[0]+v*d[0],origin[1]+u*e[1]+v*d[1]);assert.ok(a);assert.ok(Math.abs(a.height-f(u,v))<1e-11);
      const du=4*u+.3+v*(.4+.2*u),dv=.2+.4*u+.1*u*u;
      assert.ok(Math.abs(a.gradient[0]-(du*d[1]-dv*e[1])/det)<1e-12);assert.ok(Math.abs(a.gradient[1]-(-du*d[0]+dv*e[0])/det)<1e-12);
    }
    assert.equal(q.query(NaN,0),null);assert.equal(q.query(50.01,0),null);
  }
});
test('GPR3 binary preserves every Float64 control and common clipping metadata, rejects malformed records before allocation',()=>{
  const {m}=surface(30),raw=encodePrincipalBinary(m);assert.deepEqual(decodePrincipalBinary(raw),m);assert.equal(raw.byteLength,48+6*24+36);
  for(const offset of [0,4,6]){const b=raw.slice(0);new DataView(b).setUint8(offset,255);assert.throws(()=>decodePrincipalBinary(b));}
  const huge=raw.slice(0);new DataView(huge).setUint32(8,0xffffffff,true);assert.throws(()=>decodePrincipalBinary(huge));
  const count=raw.slice(0);new DataView(count).setUint32(48+6*24+4,0xffffffff,true);assert.throws(()=>decodePrincipalBinary(count));
  const reserved=raw.slice(0);new DataView(reserved).setUint16(48+6*24+2,1,true);assert.throws(()=>decodePrincipalBinary(reserved));
  assert.throws(()=>decodePrincipalBinary(raw.slice(0,-1)));const extra=new Uint8Array(raw.byteLength+1);extra.set(new Uint8Array(raw));assert.throws(()=>decodePrincipalBinary(extra));
});
test('invalid horizontal curvature, degenerate projections and unsafe controls are rejected',()=>{
  for(const mutate of [m=>m.points[1][0]+=.01,m=>m.points[4][1]+=.01,m=>m.points[0][2]=NaN,m=>m.patches[0].left[1]=999,m=>m.clip_bounds[0]=m.clip_bounds[2],m=>{for(let i=3;i<6;i++)m.points[i]=[...m.points[i-3]];}]){
    const {m}=surface(30);mutate(m);assert.throws(()=>validatePrincipalModel(m));
  }
});
test('prepared queries own their coefficients and retain first-hit gradient choice at shared faces',()=>{
  const {m}=surface(30),q=preparePrincipalQuery(m),before=q.query(-10,-10);m.points[0][2]+=100;assert.deepEqual(q.query(-10,-10),before);
  const triangles={format:'gugis-research-surface',version:3,coordinate_system:'LOCAL_METERS',clip_bounds:[0,0,1,1],points:[[0,0,0],[1,0,1],[1,1,2],[0,1,4]],patches:[{kind:'triangle-strip',indices:[0,1,2]},{kind:'triangle-strip',indices:[0,2,3]}]};
  const p=preparePrincipalQuery(decodePrincipalBinary(encodePrincipalBinary(triangles)));assert.equal(p.query(.5,.5).patch,0);assert.deepEqual(p.query(.5,.5).gradient,[1,1]);assert.equal(p.query(.1,.9).patch,1);
});
test('same-codec P2 nodes reproduce a general Cartesian quadratic and its analytic derivatives',()=>{
  const h=(x,y)=>30+.004*x*x+.003*x*y+.002*y*y,points=[],pool=new Map(),patches=[];
  for(const tri of [[[-50,-50],[50,-50],[50,50]],[[-50,-50],[50,50],[-50,50]]]){
    const ids=[];for(let a=2;a>=0;a--)for(let b=2-a;b>=0;b--){const c=2-a-b,x=(a*tri[0][0]+b*tri[1][0]+c*tri[2][0])/2,y=(a*tri[0][1]+b*tri[1][1]+c*tri[2][1])/2,key=`${x},${y}`;
      if(!pool.has(key)){pool.set(key,points.length);points.push([x,y,h(x,y)]);}ids.push(pool.get(key));}
    patches.push({kind:'lagrange-triangle',degree:2,indices:ids});
  }
  const m={format:'gugis-research-surface',version:3,coordinate_system:'LOCAL_METERS',clip_bounds:[-50,-50,50,50],points,patches},binary=encodePrincipalBinary(m),q=preparePrincipalQuery(decodePrincipalBinary(binary));
  assert.equal(binary.byteLength,336);assert.equal(points.length,9);
  for(const x of [-50,-37.1,0,41.3,50])for(const y of [-50,-21.9,0,13.7,50]){const a=q.query(x,y);assert.ok(a);assert.ok(Math.abs(a.height-h(x,y))<1e-10);assert.ok(Math.abs(a.gradient[0]-(.008*x+.003*y))<1e-12);assert.ok(Math.abs(a.gradient[1]-(.003*x+.004*y))<1e-12);}
  const invalid=structuredClone(m);invalid.points[1][0]+=.01;assert.throws(()=>validatePrincipalModel(invalid));
});

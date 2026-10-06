import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareCompactSourceBandQuery} from '../src/compare/compactSourceBandQuery.ts';
import {decodeSourceBandBinary,prepareSourceBandQuery} from '../src/compare/sourceRuledBandMath.ts';
const root=new URL('../../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const summary=JSON.parse(await readFile(new URL('shared/source-native-bands-v1.json',root)));
const points=[];for(let i=0;i<128;i++)for(let j=0;j<32;j++)points.push([-32+(i+.38196601125)/2,-32+(j+.61803398875)*2]);
for(let j=0;j<=64;j++)for(let i=0;i<=64;i++)points.push([-32+i,-32+j]);
for(let k=1;k<64;k++)for(const delta of [-2e-11,-1e-11,-1e-12,0,1e-12,1e-11,2e-11]){points.push([-32+k+delta,.618],[-.381,-32+k+delta]);}
function equalQueries(a,b){assert.ok(a&&b);for(const k of ['patch','segment','primitive','kind','u','v','easting','northing'])assert.equal(a[k],b[k],k);assert.ok(Math.abs(a.height-b.height)<1e-9);for(let k=0;k<2;k++)assert.ok(Math.abs(a.gradient[k]-b.gradient[k])<1e-9);}
test('all twenty saved source windows retain height, gradient and seam ownership on the compact path',async()=>{
  let checked=0;
  for(const c of summary.cases){const entry=c.models.find(m=>m.family==='ruled'),raw=await readFile(new URL(`frontend/public/research/source-native-bands-v1/${c.id}/${entry.binary_filename}`,root));assert.equal(sha(raw),entry.binary_sha256);
    const model=decodeSourceBandBinary(raw),fast=prepareCompactSourceBandQuery(model),frozen=prepareSourceBandQuery(model);assert.equal(fast.implementation,'compact-source-band');assert.equal(fast.execution_points,4225);assert.equal(frozen.execution_points,8385);
    for(const [x,y] of points){equalQueries(fast.query(x,y),frozen.query(x,y));checked++;}
    for(const [x,y] of [[-32-1e-12,0],[32+1e-12,0],[0,-32-1e-12],[0,32+1e-12],[NaN,0],[0,Infinity]])assert.equal(fast.query(x,y),null);
  }
  assert.equal(checked,20*points.length);
});
test('non-specialized models retain the exact frozen query and preparation owns the input',async()=>{
  const c=summary.cases[0],read=async family=>decodeSourceBandBinary(await readFile(new URL(`frontend/public/research/source-native-bands-v1/${c.id}/${c.models.find(m=>m.family===family).binary_filename}`,root)));
  for(const family of ['source_p1','source_p2']){const m=await read(family),a=prepareCompactSourceBandQuery(m),b=prepareSourceBandQuery(m);assert.equal(a.implementation,'generic-source-band');assert.deepEqual(a.query(.381,.618),b.query(.381,.618));}
  const m=await read('ruled'),a=prepareCompactSourceBandQuery(m),before=a.query(.381,.618);m.points[0][2]=999;m.origin_bng[0]=0;m.patches[0].left[0]=17;assert.deepEqual(a.query(.381,.618),before);
  const altered=await read('ruled');altered.points[0][2]+=.123456789;assert.equal(prepareCompactSourceBandQuery(altered).implementation,'generic-source-band');
  altered.points[0][2]=NaN;assert.throws(()=>prepareCompactSourceBandQuery(altered));
});

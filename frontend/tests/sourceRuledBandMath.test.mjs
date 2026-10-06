import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSourceBandBinary,decodeSourceBandBinary,prepareSourceBandQuery,encodeRegularGridBinary,decodeRegularGridBinary,prepareRegularGridQuery,validateSourceBandModel} from '../src/compare/sourceRuledBandMath.ts';
function fixture(){
  const points=[],left=[],right=[];for(let y=0;y<2;y++)for(let x=0;x<3;x++){const z=y===0?[30,31,30][x]:[32,34,31][x];points.push([x,y,z]);(y?right:left).push(points.length-1);}
  const frame={clip_bounds:[0,0,2,1],origin_bng:[383805.5,398336.5],horizontal_epsg:27700,vertical_datum:'ODN'};
  return {m:{format:'gugis-research-surface',version:4,coordinate_system:'LOCAL_METERS',...frame,points,patches:[{kind:'ruled-strip',left,right}]},grid:{...frame,width:3,height:2,values:new Float32Array(points.map(p=>p[2]))}};
}
test('source linear bands preserve the same bilinear height and Cartesian gradient as the original Float32 grid',()=>{
  const {m,grid}=fixture(),native=prepareSourceBandQuery(decodeSourceBandBinary(encodeSourceBandBinary(m))),raster=prepareRegularGridQuery(decodeRegularGridBinary(encodeRegularGridBinary(grid)));
  assert.equal(native.stored_points,6);assert.equal(native.primitives,2);assert.equal(native.stored_patches,1);
  for(const x of [0,.137,.519,.881,1,1.381,1.618,2])for(const y of [0,.249,.618,1]){
    const a=native.query(x,y),b=raster.query(x,y);assert.ok(a&&b);assert.ok(Math.abs(a.height-b.height)<1e-11);for(let k=0;k<2;k++)assert.ok(Math.abs(a.gradient[k]-b.gradient[k])<1e-11);
    assert.equal(a.patch,0);assert.equal(a.segment,x<=1?0:1);assert.equal(a.easting,383805.5+x);assert.equal(a.northing,398336.5+y);
  }
  assert.equal(native.query(-.001,0),null);assert.equal(raster.query(0,1.001),null);assert.equal(native.query(NaN,0),null);
});
test('complete GPR4 and regular-grid files round-trip all source metadata and reject hostile headers and trailing bytes',()=>{
  const {m,grid}=fixture(),band=encodeSourceBandBinary(m),raw=encodeRegularGridBinary(grid);assert.deepEqual(decodeSourceBandBinary(band),m);
  assert.deepEqual(decodeRegularGridBinary(raw),grid);assert.equal(band.byteLength,80+6*24+12+6*4);assert.equal(raw.byteLength,80+6*4);
  for(const input of [band,raw])for(const offset of [0,4,6,64,68,70,72]){const b=input.slice(0);new DataView(b).setUint8(offset,255);assert.throws(()=>input===band?decodeSourceBandBinary(b):decodeRegularGridBinary(b));}
  const huge=band.slice(0);new DataView(huge).setUint32(8,0xffffffff,true);assert.throws(()=>decodeSourceBandBinary(huge));
  const odd=band.slice(0);new DataView(odd).setUint32(80+6*24+4,5,true);assert.throws(()=>decodeSourceBandBinary(odd));
  const extra=new Uint8Array(band.byteLength+1);extra.set(new Uint8Array(band));assert.throws(()=>decodeSourceBandBinary(extra));assert.throws(()=>decodeRegularGridBinary(raw.slice(0,-1)));
});
test('source preparation owns height controls and coordinate metadata and rejects folded bands',()=>{
  const {m,grid}=fixture(),a=prepareSourceBandQuery(m),b=prepareRegularGridQuery(grid),beforeA=a.query(.5,.5),beforeB=b.query(.5,.5);
  m.points[0][2]=999;m.origin_bng[0]=0;grid.values[0]=999;grid.origin_bng[1]=0;assert.deepEqual(a.query(.5,.5),beforeA);assert.deepEqual(b.query(.5,.5),beforeB);
  for(const mutate of [m=>m.points[4][0]+=.1,m=>m.patches[0].left[1]=999,m=>m.origin_bng[0]=NaN,m=>m.vertical_datum='unknown']){const {m}=fixture();mutate(m);assert.throws(()=>validateSourceBandModel(m));}
  const {grid:g}=fixture();g.width=2.5;assert.throws(()=>prepareRegularGridQuery(g));
});

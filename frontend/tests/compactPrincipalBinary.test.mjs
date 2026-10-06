import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePrincipalBinary,decodePrincipalBinary,preparePrincipalQuery} from '../src/compare/principalRuledMath.ts';
import {encodeCompactPrincipal,restoreCompactPrincipal,decodeCompactPrincipal} from '../src/compare/compactPrincipalBinary.ts';

function model(signed=false){return {format:'gugis-research-surface',version:3,coordinate_system:'LOCAL_METERS',clip_bounds:[0,0,2,2],points:[[0,0,1],[2,0,2],[0,2,3],[signed?-0:0,0,7],[2,0,8],[0,2,9]],patches:[{kind:'triangle-strip',indices:[0,1,2]},{kind:'triangle-strip',indices:[3,4,5]}]};}
const compact=()=>new Uint8Array(encodeCompactPrincipal(encodePrincipalBinary(model())));

test('uniform coordinate sharing restores exact bytes and keeps discontinuous PT elevations and seam ownership',()=>{
  const original=new Uint8Array(encodePrincipalBinary(model())),encoded=compact();
  assert.ok(encoded.length<original.length);assert.deepEqual(new Uint8Array(restoreCompactPrincipal(encoded)),original);
  const decoded=decodeCompactPrincipal(encoded);assert.equal(decoded.points.length,6);assert.equal(decoded.points[3][2],7);
  assert.deepEqual(decoded,decodePrincipalBinary(original));
  const before=preparePrincipalQuery(decodePrincipalBinary(original)),after=preparePrincipalQuery(decoded);
  for(const [x,y] of [[0,0],[1,0],[0,1],[.25,.25],[1,1],[2,2]])assert.deepEqual(after.query(x,y),before.query(x,y));
  assert.equal(after.query(.25,.25).patch,0);
});

test('signed zeros and source views restore bit-for-bit; increased file size is allowed',()=>{
  const original=new Uint8Array(encodePrincipalBinary(model(true))),padded=new Uint8Array(original.length+17);padded.set(original,9);
  const encoded=encodeCompactPrincipal(padded.subarray(9,9+original.length));
  assert.ok(encoded.byteLength>original.length);assert.equal(new DataView(encoded).getUint32(8,true),4);
  assert.deepEqual(new Uint8Array(restoreCompactPrincipal(encoded)),original);
  assert.ok(Object.is(decodeCompactPrincipal(encoded).points[3][0],-0));
});

test('unknown headers, oversized allocations, dictionary corruption, invalid topology and trailing bytes are rejected',()=>{
  const mutate=(fn,pattern)=>{const b=compact();fn(b,new DataView(b.buffer));assert.throws(()=>restoreCompactPrincipal(b),pattern);};
  for(const length of [0,1,63])assert.throws(()=>restoreCompactPrincipal(new Uint8Array(length)),/length/);
  mutate((b,d)=>d.setUint16(6,2,true),/header/);
  mutate((b,d)=>d.setUint32(12,0xffffffff,true),/capacity/);
  mutate((b,d)=>d.setUint32(24,20001,true),/capacity/);
  mutate((b,d)=>d.setUint32(8,20001,true),/capacity/);
  mutate(b=>b.set(b.subarray(64,80),80),/Repeated/);
  mutate((b,d)=>d.setUint32(112,3,true),/index/);
  mutate((b,d)=>d.setUint32(112,1,true),/Noncanonical/);
  mutate((b,d)=>d.setUint32(112+3*12,1,true),/Degenerate/);
  mutate((b,d)=>d.setUint8(64+3*16+6*12,255),/patch/);
  assert.throws(()=>restoreCompactPrincipal(compact().subarray(0,-1)),/records/);
  const appended=new Uint8Array(compact().length+1);appended.set(compact());assert.throws(()=>restoreCompactPrincipal(appended),/records/);
});

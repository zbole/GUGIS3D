import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedCityRead} from '../src/studio/sharedCityRead.ts';
import {fetchApiJson} from '../src/studio/apiResponse.ts';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('StrictMode detach/reattach joins one read; resolved results are not reused after edits',async()=>{
  let calls=0,release;const read=createSharedCityRead(async(signal,report)=>{calls++;report({phase:'receiving',received:7,total:20});return new Promise(resolve=>{release=resolve;});});const first=new AbortController(),a=read({signal:first.signal});first.abort();const progress=[],b=read({onProgress:p=>progress.push(p)});await assert.rejects(a,{name:'AbortError'});await tick();assert.equal(calls,1);release({revision:'one'});assert.deepEqual(await b,{revision:'one'});assert.equal(progress[0].received,7);
  const next=read();await tick();assert.equal(calls,2);release({revision:'two'});assert.deepEqual(await next,{revision:'two'});
});
test('one reader cancellation cannot stop another; removing all clients aborts the underlying read',async()=>{
  const jobs=[];const read=createSharedCityRead((signal)=>new Promise((resolve,reject)=>{jobs.push({signal,resolve});signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError'))); }));const one=new AbortController(),two=new AbortController(),a=read({signal:one.signal}),b=read({signal:two.signal});await tick();one.abort();await assert.rejects(a,{name:'AbortError'});assert.equal(jobs[0].signal.aborted,false);two.abort();await assert.rejects(b,{name:'AbortError'});await tick();assert.equal(jobs[0].signal.aborted,true);const next=read();await tick();assert.equal(jobs.length,2);jobs[1].resolve('fresh');assert.equal(await next,'fresh');
});
test('failed reads retry freshly, independent city closures never share, progress mutation and observers do not corrupt data',async()=>{
  let calls=0;const london=createSharedCityRead(async(s,r)=>{calls++;r({phase:'receiving',received:4,total:null});if(calls===1)throw undefined;return 'london';}),bristol=createSharedCityRead(async()=> 'bristol');await assert.rejects(london());const observations=[],a=london({onProgress:p=>{p.received=999;throw Error('UI observer');}}),b=london({onProgress:p=>observations.push(p.received)});assert.deepEqual(await Promise.all([a,b,bristol()]),['london','london','bristol']);assert.equal(calls,2);assert.deepEqual(observations,[4]);
});
test('streamed Unicode JSON counts received bytes, unknown/compressed totals stay indeterminate and malformed success fails',async()=>{
  const old=globalThis.fetch,raw=new TextEncoder().encode(JSON.stringify({name:'布里斯托',id:23})),updates=[];try{globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(const byte of raw)c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'Content-Length':String(raw.length)}});const value=await fetchApiJson('/current',{}, {onProgress:p=>updates.push(p)});assert.deepEqual(value,{name:'布里斯托',id:23});assert.equal(updates.at(-1).received,raw.length);assert.equal(updates.at(-1).total,raw.length);assert.equal(updates.at(-1).phase,'parsing');
    for(const headers of [{},{'Content-Encoding':'gzip','Content-Length':'5'}]){const states=[];globalThis.fetch=async()=>new Response(raw,{headers});await fetchApiJson('/current',{}, {onProgress:p=>states.push(p)});assert.equal(states.at(-1).total,null);}
    globalThis.fetch=async()=>new Response(Uint8Array.of(0xff));await assert.rejects(fetchApiJson('/current',{}, {onProgress:()=>{}}),/无法解析/);
  }finally{globalThis.fetch=old;}
});
test('stream interruption and gateway errors stay explicit and writes never enter progress parsing or replay',async()=>{
  const old=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>{calls++;return new Response(new ReadableStream({start(c){c.error(new DOMException('interrupted','AbortError'));}}));};await assert.rejects(fetchApiJson('/current',{}, {onProgress:()=>{}}),/请求已中断/);globalThis.fetch=async()=>{calls++;return new Response('<html>trace</html>',{status:502});};await assert.rejects(fetchApiJson('/current',{}, {onProgress:()=>{}}),/502/);await assert.rejects(fetchApiJson('/current',{method:'POST'}, {writes:true,onProgress:()=>assert.fail('Write progress parsing used')}),/操作结果未确认/);assert.equal(calls,3);}finally{globalThis.fetch=old;}
});

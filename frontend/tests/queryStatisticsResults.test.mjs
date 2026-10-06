import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/query-statistics-results.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/QueryStatisticsResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/query-statistics-display-v1.json')));
test('statistics retain all five cases, original-timing scope, ratio definitions and case-specific execution-order diagnostics',()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('Statistics must not fetch models');let r;
  try{act(()=>r=create(React.createElement(Card)));assert.equal(r.root.findByType('tbody').findAllByType('tr').length,5);assert.match(text(r.root.findByProps({className:'qs-metrics'})),/1\.37/);assert.match(text(r.root.findByProps({className:'qs-scope'})),/没有重新计时/);assert.match(text(r.toJSON()),/区别于 17 个配对速度比的中位数/);assert.match(text(r.toJSON()),/不是 BCa/);assert.match(text(r.toJSON()),/串行关联或运行时漂移/);
    act(()=>r.root.findByProps({'aria-label':'查询统计样例'}).props.onChange({target:{value:'extruded-quadratic'}}));assert.match(text(r.root.findByProps({className:'qs-metrics'})),/1\.09/);assert.match(text(r.root.findByProps({className:'qs-orders'})),/9 对/);assert.match(text(r.root.findByProps({className:'qs-orders'})),/8 对/);assert.equal(r.root.findAllByType('svg').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('every displayed result, original trial receipt, figure and package is byte-bound to immutable evidence',async()=>{
  const sha=b=>createHash('sha256').update(b).digest('hex'),base='../public/research/query-statistics-v1/';for(const [file,key] of [['results.json','report_sha256'],['release-audit.json','release_audit_sha256'],['source-trials.csv','source_trials_sha256'],['paired-trials.csv','paired_csv_sha256'],['query-statistics-results.svg','figure_sha256']])assert.equal(sha(await readFile(f(base+file))),report[key]);const raw=JSON.parse(await readFile(f(base+'results.json')));assert.deepEqual(raw.cases,report.cases);const zip=await readFile(f(base+report.package.filename));assert.equal(zip.length,report.package.bytes);assert.equal(sha(zip),report.package.sha256);assert.deepEqual(await readFile(f(base+'source-trials.csv')),await readFile(f('../public/research/native-query-v1/trials.csv')));
});
test('statistical deep links mount their closed group without changing native query loading and clean up listeners',async()=>{
  const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/query-statistics-disclosure.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/QueryStatisticsDisclosure.tsx')),out);const Disclosure=(await import(pathToFileURL(out).href)).default;
  const previous=globalThis.window,previousFetch=globalThis.fetch,listeners=new Map();let r;
  try{globalThis.window={location:{hash:'#native-query-statistics'},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:(n,fn)=>{if(listeners.get(n)===fn)listeners.delete(n);}};globalThis.fetch=()=>assert.fail('Statistics must not fetch native files');await act(async()=>r=create(React.createElement(Disclosure)));for(let i=0;i<40&&!r.root.findAllByProps({id:'native-query-statistics'}).length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});assert.equal(r.root.findAllByProps({id:'native-query-statistics'}).length,1);assert.equal(r.root.findByProps({id:'native-query-statistics-evidence'}).props.open,true);act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());globalThis.window=previous;globalThis.fetch=previousFetch;}
});

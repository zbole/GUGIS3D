import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/native-repeat-results.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/NativeQueryRepeatResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/native-query-repeat-display-v1.json')));
test('all three repetitions and five cases remain visible with honest observed-range and CPU definitions',()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('CPU repetition results must not load city/native models');let r;
  try{act(()=>r=create(React.createElement(Card)));assert.match(text(r.toJSON()),/15 \/ 15/);assert.match(text(r.toJSON()),/1\.02–1\.41×/);assert.match(text(r.toJSON()),/不能当作置信区间/);assert.match(text(r.toJSON()),/不是浏览器\/GPU 帧率/);assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,5);assert.equal(r.root.findAllByType('tbody')[1].findAllByType('tr').length,3);
    const before=text(r.root.findByProps({className:'qs-metrics'}));act(()=>r.root.findByProps({'aria-label':'独立进程查询样例'}).props.onChange({target:{value:'extruded-quadratic'}}));assert.notEqual(text(r.root.findByProps({className:'qs-metrics'})),before);assert.match(text(r.root.findByProps({className:'qs-metrics'})),/1\.024/);assert.equal(r.root.findByType('svg').findAllByType('circle').length,3);assert.equal(r.root.findAllByType('canvas').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});
test('all report, trial, native kernel, figure and package downloads match exact receipt bytes',async()=>{
  const sha=b=>createHash('sha256').update(b).digest('hex'),base='../public/research/native-query-repeat-v1/';
  for(const [file,key] of [['results.json','report_sha256'],['run-receipt.json','receipt_sha256'],['all-trials.csv','trials_sha256'],['native-audit.json','native_audit_sha256'],['release-audit.json','release_audit_sha256'],['native-repeat-results.svg','figure_sha256'],['original-results.json','baseline_report_sha256']])assert.equal(sha(await readFile(f(base+file))),report[key]);
  const receipt=JSON.parse(await readFile(f(base+'run-receipt.json')));for(const run of receipt.runs){assert.equal(sha(await readFile(f(base+run.folder+'/results.json'))),run.report_sha256);assert.equal(sha(await readFile(f(base+run.folder+'/trials.csv'))),run.trials_sha256);}
  for(const [p,h] of Object.entries({...report.scripts,...report.release_scripts})){const original=(await readFile(f('../../'+p),'utf8')).replace(/\r\n/g,'\n'),snapshot=(await readFile(f(base+'implementation/'+p),'utf8')).replace(/\r\n/g,'\n');assert.equal(sha(original),h);assert.equal(snapshot,original);}
  const zip=await readFile(f(base+report.package.filename));assert.equal(zip.length,report.package.bytes);assert.equal(sha(zip),report.package.sha256);
});
test('fresh-repeat deep links mount only their evidence and remove all navigation listeners',async()=>{
  const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/native-repeat-disclosure.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/NativeQueryRepeatDisclosure.tsx')),out);const Disclosure=(await import(pathToFileURL(out).href)).default;
  const previous=globalThis.window,previousFetch=globalThis.fetch,listeners=new Map();let r;
  try{globalThis.window={location:{hash:'#native-query-repeat'},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:(n,fn)=>{if(listeners.get(n)===fn)listeners.delete(n);}};globalThis.fetch=()=>assert.fail('Repeat disclosure must not fetch models');await act(async()=>r=create(React.createElement(Disclosure)));for(let i=0;i<40&&!r.root.findAllByProps({id:'native-query-repeat'}).length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});assert.equal(r.root.findAllByProps({id:'native-query-repeat'}).length,1);assert.equal(r.root.findByProps({id:'native-query-repeat-evidence'}).props.open,true);act(()=>r.unmount());r=null;assert.equal(listeners.size,0);
  }finally{if(r)act(()=>r.unmount());globalThis.window=previous;globalThis.fetch=previousFetch;}
});
test('the main native results link mounts repeat/statistical disclosures without eager model loading',async()=>{
  const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/native-query-integrated.mjs'));await bundleWorkspaceModule(fileURLToPath(f('../src/compare/NativeQueryResults.tsx')),out);const Native=(await import(pathToFileURL(out).href)).default;const previous=globalThis.fetch;let r;
  try{globalThis.fetch=()=>assert.fail('Closed native, repeat and statistical demonstrations must not fetch models');act(()=>r=create(React.createElement(Native)));assert.equal(r.root.findAllByProps({id:'native-query-repeat-evidence'}).length,1);assert.equal(r.root.findAllByProps({id:'native-query-statistics-evidence'}).length,1);assert.equal(r.root.findAllByProps({id:'native-query-repeat'}).length,0);assert.equal(r.root.findAllByType('canvas').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=previous;}
});

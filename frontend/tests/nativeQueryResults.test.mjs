import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const f=p=>new URL(p,import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/native-query-results.mjs'));
await build({entryPoints:[fileURLToPath(f('../src/compare/NativeQueryResults.tsx'))],outfile:out,bundle:true,format:'esm',platform:'node',packages:'external',loader:{'.css':'empty'}});
const {default:Card}=await import(pathToFileURL(out).href);
const kernel=fileURLToPath(f('../node_modules/.cache/gugis-tests/native-query-check.mjs'));
await build({stdin:{contents:"export {prepareOrderQuery} from './preparedOrderQuery';export {decodeOrderBinary,orderQuery} from './terrainOrderMath';",resolveDir:fileURLToPath(f('../src/compare/')),loader:'ts'},outfile:kernel,bundle:true,format:'esm',platform:'node'});
const {prepareOrderQuery,decodeOrderBinary,orderQuery}=await import(pathToFileURL(kernel).href);
const report=JSON.parse(await readFile(f('../../shared/native-query-performance-v1.json'))),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
test('result cards keep all five fixed cases, measured scope and download receipts without eagerly loading models',()=>{
  const before=globalThis.fetch;let r;globalThis.fetch=()=>assert.fail('Closed result page must not read native models');
  try{act(()=>r=create(React.createElement(Card)));assert.match(text(r.toJSON()),/66\.3/);assert.match(text(r.toJSON()),/1\.25/);
    assert.match(text(r.toJSON()),/不是 ArcGIS 软件或 GPU 帧率/);assert.equal(r.root.findAllByType('canvas').length,0);
    assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,5);
    act(()=>r.root.findByProps({'aria-label':'原生查询对照规模'}).props.onChange({target:{value:'piecewise-8'}}));
    assert.match(text(r.root.findByProps({className:'nq-metrics'})),/65\.5/);assert.match(text(r.root.findByProps({className:'nq-metrics'})),/1\.37/);
    assert.ok(r.root.findAllByType('a').some(a=>a.props.href==='/research/native-query-v1/piecewise-8/p3-triangles.bin'));
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});
test('published speed summary and all immutable source pins match complete trials',async()=>{
  const raw=await readFile(f('../public/research/native-query-v1/results.json')),full=JSON.parse(raw);assert.equal(sha(raw),report.report_sha256);
  assert.deepEqual(await readFile(f('../../shared/native-query-performance-v1.json')),await readFile(f('../public/research/native-query-v1/publication.json')));
  for(const [p,h] of Object.entries(report.scripts))assert.equal(sha((await readFile(f('../../'+p),'utf8')).replace(/\r\n/g,'\n')),h);
  for(const c of report.cases){const original=full.cases.find(a=>a.id===c.id);
    assert.deepEqual(Object.fromEntries(Object.entries(c).filter(([k])=>k!=='binary_saving_percent')),Object.fromEntries(Object.entries(original).filter(([k])=>k!=='rows')));
    assert.equal(original.rows.length,44);assert.equal(c.binary_saving_percent,100*(1-c.methods[0].binary_bytes/c.methods[1].binary_bytes));
  }
  const zip=await readFile(f('../public/research/native-query-v1/native-query-evidence.zip'));assert.equal(zip.length,report.package.bytes);assert.equal(sha(zip),report.package.sha256);
});
test('all piecewise native functions reproduce independent height and gradients and retain first-hit boundary ownership',async()=>{
  for(const c of report.cases.filter(c=>c.id.startsWith('piecewise-')))for(const m of c.methods){
    const raw=await readFile(f(`../public/research/native-query-v1/${c.id}/${m.binary_filename}`));assert.equal(sha(raw),m.binary_sha256);
    const model=decodeOrderBinary(raw),prepared=prepareOrderQuery(model),n=c.strips,w=100/n;
    for(let j=0;j<n;j++)for(const u of [.137,.519,.881])for(const y of [-49,-17,49]){
      const x=-50+(j+u)*w,l=-50+j*w,a=(.2+.05*Math.cos(2*Math.PI*j/n))/(w*w),s=(x-l)*(x-l-w);
      const q=prepared.query(x,y);assert.ok(q);assert.ok(Math.abs(q.height-(30+.001*x+.002*y+a*s*(1+.002*y)))<1e-9);
      for(const [k,value] of [.001+a*(2*(x-l)-w)*(1+.002*y),.002+.002*a*s].entries())assert.ok(Math.abs(q.gradient[k]-value)<1e-9);
    }
    for(let j=0;j<=n;j++)for(const y of [-50,0,50]){
      const x=-50+j*w,a=prepared.query(x,y),b=orderQuery(model,x,y);assert.ok(a&&b);assert.equal(a.patch,b.patch);
      assert.ok(Math.abs(a.height-(30+.001*x+.002*y))<1e-9);for(let k=0;k<2;k++)assert.ok(Math.abs(a.gradient[k]-b.gradient[k])<1e-9);
    }
  }
});
test('native demo loads checksum-bound models only on demand, shares visible height range and cancels after closing',async()=>{
  const before=globalThis.fetch,calls=[];let r;
  try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f(`../public${url}`)));};
    act(()=>r=create(React.createElement(Card)));await act(async()=>{r.root.findByProps({'aria-label':'展开面带函数演示'}).props.onClick();await new Promise(resolve=>setTimeout(resolve,50));});
    for(let i=0;i<12&&!r.root.findAllByProps({className:'nq-demo'}).length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
    assert.equal(calls.length,2);assert.equal(r.root.findAllByType('svg').length,2);assert.match(text(r.root.findByProps({className:'nq-models'})),/514 个共享点/);
    act(()=>r.root.findByProps({'aria-label':'面带规模查询X'}).props.onChange({target:{value:'41.3'}}));assert.equal(r.root.findByProps({'aria-label':'面带规模查询X'}).props.value,41.3);
    const ranges=r.root.findAllByType('text').map(text).filter(t=>t.startsWith('Z:'));assert.equal(ranges.length,2);assert.equal(ranges[0],ranges[1]);
    act(()=>r.root.findByProps({'aria-label':'展开面带函数演示'}).props.onClick());assert.ok(calls.every(c=>c.signal.aborted));assert.equal(r.root.findAllByType('svg').length,0);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=before;}
});

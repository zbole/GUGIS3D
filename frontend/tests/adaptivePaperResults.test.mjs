import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
import {decodePrincipalBinary,preparePrincipalQuery} from '../src/compare/principalRuledMath.ts';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/adaptive-paper-results.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/AdaptivePaperResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/paper-adaptive-projection-ui-v1.json')));
const wait=async fn=>{for(let i=0;i<60&&!fn();i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});assert.ok(fn(),'Expected saved adaptive PT state');};
test('full paper-adaptive results retain six controls, the losing budget, higher-order accuracy and all 63 outcomes without model requests',()=>{
  const old=globalThis.fetch;let r;try{globalThis.fetch=()=>assert.fail('Closed native demonstration must not fetch');act(()=>r=create(React.createElement(Card)));const s=text(r.toJSON());assert.match(s,/46\.03%/);assert.match(s,/58\.85%/);assert.match(s,/62\/63/);assert.match(s,/公式 \(2\.18\)/);assert.match(s,/实际文件大小不相等/);assert.match(s,/仍比拟合面带更准确/);assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,6);assert.equal(r.root.findAllByType('tbody')[1].findAllByType('tr').length,63);
    act(()=>r.root.findByProps({'aria-label':'自适应Pₜ对照预算'}).props.onChange({target:{value:'64'}}));assert.match(text(r.root.findAllByProps({className:'hs-metrics'})[0]),/1\.16%升高/);act(()=>r.root.findByProps({'aria-label':'自适应Pₜ对照函数'}).props.onChange({target:{value:'published-quartic'}}));assert.match(text(r.toJSON()),/10\/63/);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});
test('old PT, freshly adaptive PT and GUGIS heatmaps query actual saved bytes with one scale and no reread on point selection',async()=>{
  const old=globalThis.fetch,calls=[];let r;try{globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f('../public'+url)));};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开完整自适应Pₜ原生对照'}).props.onClick());await wait(()=>r.root.findAllByProps({className:'pf-error-map'}).length===3);assert.equal(calls.length,3);assert.equal(new Set(r.root.findAllByProps({className:'pf-heat-scale'}).map(text)).size,1);
    const site=report.cases.find(c=>c.id==='anisotropic-quartic-30'),p=site.pairs.find(p=>p.budget===2048);
    for(const [i,key] of ['pt','adaptive','fitted'].entries()){const e=site.models[p[key]],fn=preparePrincipalQuery(decodePrincipalBinary(await readFile(f(`../public/research/${e.package}/${site.id}/${e.binary_filename}`)))),cells=r.root.findAllByProps({className:'pf-error-map'})[i].findAllByType('rect');assert.equal(cells.length,289);for(const cell of cells){const x=cell.props['data-x'],y=cell.props['data-y'],frame=site.source_frame,u=x*frame[0][0]+y*frame[1][0],v=x*frame[0][1]+y*frame[1][1],z=30+site.field.quadratic[0]*u*u+site.field.quadratic[1]*v*v+site.field.quartic[0]*u**4+site.field.quartic[1]*v**4;assert.ok(Math.abs(cell.props['data-delta']-(fn.query(x,y).height-z))<1e-12);}}
    const cell=r.root.findAllByProps({className:'pf-error-map'})[1].findAllByType('rect')[211];act(()=>cell.props.onClick());assert.equal(r.root.findByProps({'aria-label':'拟合原生同步查询X'}).props.value,cell.props['data-x']);assert.equal(calls.length,3);act(()=>r.root.findByProps({'aria-label':'展开完整自适应Pₜ原生对照'}).props.onClick());assert.ok(calls.every(c=>c.signal.aborted));
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});
test('corrupt new adaptive bytes fail visibly and retry validates all files rather than substituting the old fixed mesh',async()=>{
  const old=globalThis.fetch;let r,corrupt=true;try{globalThis.fetch=async url=>{const b=await readFile(f('../public'+url));if(corrupt&&url.includes('/adaptive-pt-'))b[b.length-1]^=1;return new Response(b);};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开完整自适应Pₜ原生对照'}).props.onClick());await wait(()=>r.root.findAllByProps({role:'alert'}).length===1);assert.match(text(r.root.findByProps({role:'alert'})),/SHA-256/);assert.equal(r.root.findAllByProps({className:'pf-error-map'}).length,0);corrupt=false;await act(async()=>r.root.findByProps({role:'alert'}).findByType('button').props.onClick());await wait(()=>r.root.findAllByProps({className:'pf-error-map'}).length===3);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});
test('all compact adaptive and previous controls bind actual immutable public files',async()=>{
  const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(await readFile(f('../../shared/paper-adaptive-projection-display-v1.json'))),report.source_summary_sha256);
  for(const c of report.cases)for(const e of Object.values(c.models)){const b=await readFile(f(`../public/research/${e.package}/${c.id}/${e.binary_filename}`));assert.equal(b.length,e.binary_bytes);assert.equal(sha(b),e.binary_sha256);decodePrincipalBinary(b);}
});

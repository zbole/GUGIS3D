import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
import {decodePrincipalBinary,preparePrincipalQuery} from '../src/compare/principalRuledMath.ts';
const f=p=>new URL(p,import.meta.url),text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const out=fileURLToPath(f('../node_modules/.cache/gugis-tests/paper-frontier.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/PaperFrontierResults.tsx')),out);
const Card=(await import(pathToFileURL(out).href)).default,report=JSON.parse(await readFile(f('../../shared/paper-finite-frontier-v1.json')));
const wait=async fn=>{for(let i=0;i<60&&!fn();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});assert.ok(fn(),'Expected actual finite-archive native state');};

test('equal-error result uses complete actual files, shows the smaller P2 and all candidates without fetching models',()=>{
  const old=globalThis.fetch;let r;try{
    globalThis.fetch=()=>assert.fail('Closed native viewer must not fetch');act(()=>r=create(React.createElement(Card)));
    const s=text(r.toJSON());assert.match(s,/77\.10%降低/);assert.match(s,/196,512 B → 45,000 B/);assert.match(s,/69\/69/);assert.match(s,/23,688 B/);assert.match(s,/当前比 GUGIS 文件更小/);assert.match(s,/已保存候选中无达标模型/);assert.match(s,/达标误差无需完全相等/);assert.match(s,/不能代表最小平面系数编码/);
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});

test('same-byte mode retains all five losses, and infeasible target has no fabricated savings or native viewer',()=>{
  let r;try{
    act(()=>r=create(React.createElement(Card)));act(()=>r.root.findAllByType('button').find(b=>text(b)==='同空间上限 · 比误差').props.onClick());
    const site=report.cases.find(c=>c.id==='anisotropic-quartic-30'),row=site.byte_rows.find(x=>x.ceiling_bytes===65536),fitted=site.models[row.selected.fitted],adaptive=site.models[row.selected.adaptive_pt];assert.match(text(r.toJSON()),new RegExp((100*(1-fitted.e2_m2/adaptive.e2_m2)).toFixed(2).replace('.','\\.')+'%降低'));assert.equal(r.root.findAllByType('tbody')[1].findAllByType('tr').length,70);
    act(()=>r.root.findByProps({'aria-label':'文件精度对照函数'}).props.onChange({target:{value:'published-quartic'}}));
    const losing=report.cases.filter(c=>c.field.id==='published-quartic').flatMap(c=>c.byte_rows.map(row=>({c,row}))).find(({c,row})=>row.selected.fitted&&row.selected.adaptive_pt&&c.models[row.selected.fitted].e2_m2>c.models[row.selected.adaptive_pt].e2_m2);
    act(()=>r.root.findByProps({'aria-label':'文件精度对照方向'}).props.onChange({target:{value:String(losing.c.angle_degrees)}}));act(()=>r.root.findByProps({'aria-label':'完整文件字节上限'}).props.onChange({target:{value:String(losing.row.ceiling_bytes)}}));assert.match(text(r.root.findByProps({className:'frontier-metrics'})),/%升高/);assert.match(text(r.toJSON()),/5 组失利/);
    act(()=>r.root.findAllByType('button').find(b=>text(b)==='同误差门槛 · 比文件').props.onClick());act(()=>r.root.findByProps({'aria-label':'全域E₂门槛'}).props.onChange({target:{value:'.01'}}));assert.match(text(r.toJSON()),/暂无成对结果/);assert.match(text(r.toJSON()),/没有将缺失基线当作优势/);assert.equal(r.root.findByProps({'aria-label':'展开文件精度原生同步查询'}).props.disabled,true);
  }finally{if(r)act(()=>r.unmount());}
});

test('frontier dots show every archived native receipt with actual bytes and errors rather than interpolated estimates',()=>{
  let r;try{act(()=>r=create(React.createElement(Card)));const c=report.cases.find(c=>c.id==='anisotropic-quartic-30'),dots=r.root.findAllByType('circle');assert.equal(dots.length,Object.values(c.candidates).flat().length);for(const dot of dots){const key=c.candidates[dot.props['data-method']].find(k=>c.models[k].binary_filename===dot.props['data-file']),e=c.models[key];assert.equal(dot.props['data-bytes'],e.binary_bytes);assert.equal(dot.props['data-e2'],e.e2_m2);assert.equal(dot.props.r===6,Object.values(c.error_rows.find(x=>x.target_e2_m2===.1).selected).includes(key));}assert.equal(r.root.findAllByType('tbody')[0].findAllByType('tr').length,6);assert.equal(r.root.findAllByType('tbody')[1].findAllByType('tr').length,91);
  }finally{if(r)act(()=>r.unmount());}
});

test('equal-error selected PT, ruled and stronger P2 native bytes drive synchronized actual queries',async()=>{
  const old=globalThis.fetch,calls=[];let r;try{
    globalThis.fetch=async(url,{signal})=>{calls.push({url,signal});return new Response(await readFile(f('../public'+url)));};act(()=>r=create(React.createElement(Card)));await act(async()=>r.root.findByProps({'aria-label':'展开文件精度原生同步查询'}).props.onClick());await wait(()=>r.root.findAllByProps({className:'pf-error-map'}).length===3);assert.equal(calls.length,3);
    const c=report.cases.find(c=>c.id==='anisotropic-quartic-30'),row=c.error_rows.find(x=>x.target_e2_m2===.1);
    for(const [i,method] of ['adaptive_pt','fitted','p2'].entries()){
      const e=c.models[row.selected[method]],fn=preparePrincipalQuery(decodePrincipalBinary(await readFile(f(`../public/research/${e.package}/${c.id}/${e.binary_filename}`))));
      for(const rect of r.root.findAllByProps({className:'pf-error-map'})[i].findAllByType('rect')){
        const x=rect.props['data-x'],y=rect.props['data-y'],u=x*c.source_frame[0][0]+y*c.source_frame[1][0],v=x*c.source_frame[0][1]+y*c.source_frame[1][1],z=30+c.field.quadratic[0]*u*u+c.field.quadratic[1]*v*v+c.field.quartic[0]*u**4+c.field.quartic[1]*v**4;
        assert.ok(Math.abs(rect.props['data-delta']-(fn.query(x,y).height-z))<1e-12);
      }
    }
    assert.equal(new Set(r.root.findAllByProps({className:'pf-heat-scale'}).map(text)).size,1);const rect=r.root.findAllByProps({className:'pf-error-map'})[2].findAllByType('rect')[94];act(()=>rect.props.onClick());assert.equal(r.root.findByProps({'aria-label':'拟合原生同步查询X'}).props.value,rect.props['data-x']);assert.equal(calls.length,3);act(()=>r.root.findByProps({'aria-label':'展开文件精度原生同步查询'}).props.onClick());assert.ok(calls.every(call=>call.signal.aborted));
  }finally{if(r)act(()=>r.unmount());globalThis.fetch=old;}
});

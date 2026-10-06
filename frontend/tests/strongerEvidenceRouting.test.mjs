import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),components=[];
for(const name of ['VariableCurvature','HybridSource']){
  const out=fileURLToPath(f(`../node_modules/.cache/gugis-tests/${name}-routing.mjs`));
  await bundleWorkspaceModule(fileURLToPath(f(`../src/compare/${name}Disclosure.tsx`)),out);
  components.push((await import(pathToFileURL(out).href)).default);
}
const wait=async fn=>{for(let i=0;i<60&&!fn();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});assert.ok(fn(),'Expected lazy evidence section');};
function environment(hash){
  const old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch},listeners=new Map(),scrolled=[];
  globalThis.window={location:{hash},addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn)};
  globalThis.document={getElementById:id=>({scrollIntoView:()=>scrolled.push(id)})};
  globalThis.fetch=()=>assert.fail('Closed native examples must not request models or city APIs');
  return {listeners,scrolled,emit:(type,event)=>{for(const fn of [...(listeners.get(type)??[])])fn(event);},restore:()=>Object.assign(globalThis,old)};
}
for(const [i,anchor,inner] of [[0,'paper-projection-results','paper-projection-evidence'],[1,'diagonal-hybrid-results','diagonal-hybrid-evidence']]){
  test(`${anchor} deep link opens its parent and new lazy disclosure without unrelated data fetches`,async()=>{
    const e=environment('#'+anchor);let r;
    try{await act(async()=>r=create(React.createElement(components[i])));await wait(()=>r.root.findAllByProps({id:anchor}).length===1);assert.equal(r.root.findByProps({id:inner}).props.open,true);assert.ok(e.scrolled.includes(anchor));assert.equal(r.root.findAllByType('canvas').length,0);}
    finally{if(r)act(()=>r.unmount());assert.ok([...e.listeners.values()].every(v=>v.size===0));e.restore();}
  });
}
test('results links opened after mount follow both lazy layers, while unrelated sections initially stay closed',async()=>{
  const e=environment('#validated-advantages');let r;
  try{await act(async()=>r=create(React.createElement(components[0])));assert.equal(r.root.findByType('details').props.open,false);assert.equal(r.root.findAllByProps({id:'paper-projection-results'}).length,0);
    await act(async()=>e.emit('click',{target:{closest:()=>({getAttribute:()=> '#paper-projection-results'})}}));
    globalThis.window.location.hash='#paper-projection-results';await act(async()=>e.emit('hashchange'));
    await wait(()=>r.root.findAllByProps({id:'paper-projection-results'}).length===1);assert.equal(r.root.findByProps({id:'paper-projection-evidence'}).props.open,true);
  }finally{if(r)act(()=>r.unmount());e.restore();}
});

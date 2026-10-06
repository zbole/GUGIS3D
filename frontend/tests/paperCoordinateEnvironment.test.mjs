import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const output=fileURLToPath(new URL('../node_modules/.cache/gugis-tests/coordinate-environment.mjs',import.meta.url));
await bundleWorkspaceModule(fileURLToPath(new URL('../src/compare/PaperCoordinateDisclosure.tsx',import.meta.url)),output);
const Disclosure=(await import(pathToFileURL(output).href)).default;

test('closed frontier mounts without a browser and never loads native results',()=>{
  const before=Object.getOwnPropertyDescriptor(globalThis,'window');let renderer;
  try{
    delete globalThis.window;
    act(()=>renderer=create(React.createElement(Disclosure)));
    assert.equal(renderer.root.findByType('details').props.open,false);
    assert.equal(renderer.root.findAllByProps({id:'paper-coordinate-results'}).length,0);
  }finally{if(renderer)act(()=>renderer.unmount());if(before)Object.defineProperty(globalThis,'window',before);}
});

test('partial browser bindings do not crash the overview and listeners are released',()=>{
  const before=Object.getOwnPropertyDescriptor(globalThis,'window');const listeners=new Map();let renderer;
  try{
    globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name);}};
    act(()=>renderer=create(React.createElement(Disclosure)));
    assert.equal(renderer.root.findByType('details').props.open,false);
    act(()=>listeners.get('hashchange')());
    assert.equal(renderer.root.findByType('details').props.open,false);
    act(()=>renderer.unmount());renderer=null;assert.equal(listeners.size,0);
  }finally{if(renderer)act(()=>renderer.unmount());if(before)Object.defineProperty(globalThis,'window',before);else delete globalThis.window;}
});

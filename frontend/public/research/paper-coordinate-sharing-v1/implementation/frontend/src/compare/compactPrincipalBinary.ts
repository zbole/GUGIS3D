// Lossless storage audit only. The frozen GPR3 model and query kernel are reused.
import {decodePrincipalBinary} from './principalRuledMath.ts';
const LIMIT=2_000_000,HEADER=64;
const bytes=(input:ArrayBuffer|Uint8Array)=>input instanceof Uint8Array?input:new Uint8Array(input);
const key=(view:DataView,offset:number)=>[0,4,8,12].map(k=>view.getUint32(offset+k,true).toString(16)).join(':');

export function encodeCompactPrincipal(input:ArrayBuffer|Uint8Array):ArrayBuffer{
  const raw=bytes(input);decodePrincipalBinary(raw);
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),count=view.getUint32(8,true);
  const dictionary=new Map<string,number>(),xy:number[]=[],indices:number[]=[];
  for(let i=0;i<count;i++){
    const offset=48+i*24,k=key(view,offset);let id=dictionary.get(k);
    if(id===undefined){id=dictionary.size;dictionary.set(k,id);xy.push(offset);}
    indices.push(id);
  }
  const tail=48+count*24,length=HEADER+dictionary.size*16+count*12+raw.length-tail;
  if(length>LIMIT)throw new Error('Compact principal capacity exceeded');
  const output=new Uint8Array(length),out=new DataView(output.buffer);
  output.set([71,80,67,49]);out.setUint16(4,1,true);out.setUint16(6,1,true);
  out.setUint32(8,dictionary.size,true);out.setUint32(12,raw.length,true);output.set(raw.subarray(0,48),16);
  xy.forEach((offset,i)=>output.set(raw.subarray(offset,offset+16),HEADER+i*16));
  let offset=HEADER+xy.length*16;
  indices.forEach((id,i)=>{out.setUint32(offset,id,true);output.set(raw.subarray(48+i*24+16,48+i*24+24),offset+4);offset+=12;});
  output.set(raw.subarray(tail),offset);return output.buffer;
}

export function restoreCompactPrincipal(input:ArrayBuffer|Uint8Array):ArrayBuffer{
  const source=bytes(input);
  if(source.length<HEADER||source.length>LIMIT)throw new Error('Invalid compact principal length');
  const view=new DataView(source.buffer,source.byteOffset,source.byteLength);
  if(view.getUint32(0,true)!==0x31435047||view.getUint16(4,true)!==1||view.getUint16(6,true)!==1)throw new Error('Invalid compact principal header');
  const distinct=view.getUint32(8,true),originalLength=view.getUint32(12,true),count=view.getUint32(24,true),records=view.getUint32(28,true);
  if(count<3||count>20000||records<1||records>8192||distinct<3||distinct>count||originalLength>LIMIT||originalLength<48+count*24+records*24)
    throw new Error('Invalid compact principal capacity');
  const pointOffset=HEADER+distinct*16,tailOffset=pointOffset+count*12;
  if(tailOffset+records*24>source.length||originalLength!==48+count*24+source.length-tailOffset)throw new Error('Truncated compact principal records');
  const dictionary=new Set<string>();
  for(let i=0;i<distinct;i++){
    const k=key(view,HEADER+i*16);if(dictionary.has(k))throw new Error('Repeated compact XY dictionary entry');dictionary.add(k);
  }
  const output=new Uint8Array(originalLength);output.set(source.subarray(16,HEADER));
  const seen=new Set<number>();
  for(let i=0;i<count;i++){
    const offset=pointOffset+i*12,id=view.getUint32(offset,true);
    if(id>=distinct)throw new Error('Invalid compact XY index');
    if(!seen.has(id)){if(id!==seen.size)throw new Error('Noncanonical compact XY dictionary order');seen.add(id);}
    output.set(source.subarray(HEADER+id*16,HEADER+(id+1)*16),48+i*24);
    output.set(source.subarray(offset+4,offset+12),48+i*24+16);
  }
  if(seen.size!==distinct)throw new Error('Unused compact XY dictionary entry');
  output.set(source.subarray(tailOffset),48+count*24);
  decodePrincipalBinary(output);return output.buffer;
}

export const decodeCompactPrincipal=(input:ArrayBuffer|Uint8Array)=>decodePrincipalBinary(restoreCompactPrincipal(input));

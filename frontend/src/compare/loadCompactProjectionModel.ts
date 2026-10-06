import {decodePrincipalBinary} from './principalRuledMath';
import {restoreCompactPrincipal} from './compactPrincipalBinary';
const hash=async (buffer:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
export async function loadCompactProjectionModel(url:string,bytes:number,sha256:string,originalSha:string,signal:AbortSignal){
  if(!/^\/research\/paper-coordinate-sharing-v1\/native\/(published|anisotropic)-quartic-(00|15|30|45|60|75|90)\/(p1|fixed_pt|adaptive_pt|before|fitted|p2)--[a-z0-9-]+\.gpc$/.test(url)||!Number.isSafeInteger(bytes)||bytes<64||bytes>2_000_000||![sha256,originalSha].every(h=>/^[a-f0-9]{64}$/.test(h)))throw new Error('共享坐标模型回执无效');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const response=await fetch(url,{signal});
  if(!response.ok||!response.body)throw new Error(`共享坐标模型读取失败（${response.status}）`);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let received=0;
  try{
    while(true){
      if(signal.aborted){await reader.cancel();throw new DOMException('取消读取','AbortError');}
      const {done,value}=await reader.read();if(done)break;received+=value.byteLength;
      if(received>bytes){await reader.cancel();throw new Error('共享坐标模型超过公开长度');}chunks.push(value);
    }
  }finally{reader.releaseLock();}
  if(received!==bytes)throw new Error('共享坐标模型文件不完整');
  const body=new Uint8Array(received);let offset=0;
  for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  if(await hash(body.buffer)!==sha256)throw new Error('共享坐标模型 SHA-256 不符');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const restored=restoreCompactPrincipal(body);
  if(await hash(restored)!==originalSha)throw new Error('还原后的原始模型 SHA-256 不符');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const model=decodePrincipalBinary(restored);
  if(model.clip_bounds.some((n,i)=>n!==[-50,-50,50,50][i]))throw new Error('共享坐标研究模型覆盖域改变');
  return model;
}

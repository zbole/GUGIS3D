import type { Terrain } from '../studio/environment';
export async function loadResearchTerrain(url:string,bytes:number,sha256:string,signal:AbortSignal):Promise<Terrain>{
  if(!/^\/research\/hybrid-terrain\/models\/[a-z-]+\/(hybrid|triangles)-(0\.05|0\.1|0\.25|0\.5)m\.json$/.test(url)||!Number.isSafeInteger(bytes)||bytes<1||bytes>4*1024*1024||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('Invalid research archive receipt');
  const response=await fetch(url,{signal});
  if(!response.ok||!response.body)throw new Error('研究档案读取失败');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let received=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;
      if(received>bytes){await reader.cancel();throw new Error('研究档案超出已核验文件长度');}chunks.push(value);}
  }finally{reader.releaseLock();}
  if(received!==bytes)throw new Error('研究档案不完整');
  const content=new Uint8Array(received);let offset=0;
  for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.length;}
  const digest=await crypto.subtle.digest('SHA-256',content);
  const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==sha256)throw new Error('研究档案修订不匹配');
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  // Hash refers to a backend-validated, published research archive.
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content)) as Terrain;
}

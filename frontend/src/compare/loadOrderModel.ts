import {decodeOrderBinary,type OrderModel} from './terrainOrderMath';
export async function loadOrderModel(url:string,bytes:number,sha256:string,signal:AbortSignal):Promise<OrderModel>{
  if(!/^\/research\/order-controls-v1\/(extruded-quadratic|modulated-quadratic)\/(ruled|p[23]-triangles)\.bin$/.test(url)||!Number.isSafeInteger(bytes)||bytes<16||bytes>1024*1024||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('阶数模型凭据无效');
  const response=await fetch(url,{signal});if(!response.ok||!response.body)throw new Error('阶数模型读取失败');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
    if(length>bytes){await reader.cancel();throw new Error('阶数模型超出核验长度');}chunks.push(value);}}finally{reader.releaseLock();}
  if(length!==bytes)throw new Error('阶数模型不完整');
  const content=new Uint8Array(length);let offset=0;for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.length;}
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==sha256)throw new Error('阶数模型哈希不匹配');if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  return decodeOrderBinary(content);
}

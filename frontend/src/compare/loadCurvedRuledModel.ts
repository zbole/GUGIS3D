import {validateCurveModel,type CurveModel} from './curvedRuledMath';

export async function loadCurvedRuledModel(url:string,bytes:number,sha256:string,signal:AbortSignal):Promise<CurveModel>{
  if(!/^\/research\/curved-ruled-v1\/(isotropic|anisotropic|variable_curvature)\/(curve-[xy]-\d+x\d+|(paper_l2_l1|greedy_euclidean|uniform_euclidean)-(8|16|32|64|128|256|512|1024|2048))\.json$/.test(url)
    ||!Number.isSafeInteger(bytes)||bytes<1||bytes>1024*1024||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('研究模型凭据无效');
  const response=await fetch(url,{signal});
  if(!response.ok||!response.body)throw new Error('研究模型读取失败');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
    if(length>bytes){await reader.cancel();throw new Error('研究模型超过核验长度');}chunks.push(value);}}
  finally{reader.releaseLock();}
  if(length!==bytes)throw new Error('研究模型不完整');
  const content=new Uint8Array(length);let offset=0;for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.length;}
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==sha256)throw new Error('研究模型哈希不匹配');
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  return validateCurveModel(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content)));
}

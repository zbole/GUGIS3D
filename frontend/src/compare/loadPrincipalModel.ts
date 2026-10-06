import {decodePrincipalBinary} from './principalRuledMath';
export async function loadPrincipalModel(url:string,bytes:number,sha256:string,signal:AbortSignal){
  if(!/^\/research\/principal-ruled-v1\/angle-(00|15|30|45|60|75|90)\/(paper-p1-(8|16|32|64|128|256|512|1024|2048)|(?:world-[xy]|principal)-(1|2|4|8|16|32|64|128|256|512|1024|2048)|p2-exact-control)\.bin$/.test(url)||!Number.isSafeInteger(bytes)||bytes<48||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('方向研究模型回执无效');
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`研究模型读取失败（${response.status}）`);
  const body=await response.arrayBuffer();if(body.byteLength!==bytes)throw new Error('研究模型文件长度不符');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(hash!==sha256)throw new Error('研究模型 SHA-256 校验失败');
  const model=decodePrincipalBinary(body);if(model.clip_bounds.some((v,i)=>v!==[-50,-50,50,50][i]))throw new Error('研究模型覆盖域已改变');return model;
}

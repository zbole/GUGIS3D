import {decodePrincipalBinary} from './principalRuledMath';
export async function loadAdaptiveProjectionModel(url:string,bytes:number,sha256:string,signal:AbortSignal){
  const match=/^\/research\/paper-adaptive-projection-v1\/(published-quartic|anisotropic-quartic)-(00|15|30|45|60|75|90)\/adaptive-pt-(8|16|32|64|128|256|512|1024|2048)\.bin$/.exec(url);
  if(!match||!Number.isSafeInteger(bytes)||bytes<144||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('自适应 Pₜ 原生模型回执无效');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`自适应 Pₜ 读取失败（${response.status}）`);
  const body=await response.arrayBuffer();if(body.byteLength!==bytes)throw new Error('自适应 Pₜ 文件长度不符');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(digest!==sha256)throw new Error('自适应 Pₜ SHA-256 校验失败');
  const model=decodePrincipalBinary(body),n=Number(match[3]);
  if(model.clip_bounds.some((v,i)=>v!==[-50,-50,50,50][i])||model.patches.length!==n||model.points.length>3*n||model.patches.some(p=>p.kind!=='triangle-strip'||p.indices.length!==3))throw new Error('自适应 Pₜ 空间或三角形数量不符');
  return model;
}

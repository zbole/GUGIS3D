import {decodePrincipalBinary} from './principalRuledMath.ts';
export async function loadProjectionModel(url:string,bytes:number,sha256:string,signal:AbortSignal){
  const match=url.match(/^\/research\/paper-projection-stable-v1\/(published|anisotropic)-quartic-(00|15|30|45|60|75|90)\/(pt-paper-p1-(8|16|32|64|128|256|512|1024|2048)|c0-stable-mean-hessian-(1|2|4|8|16|32)x(1|2|4|8|16|32|64|128|256|512))\.bin$/);
  if(!match||!Number.isSafeInteger(bytes)||bytes<144||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('拟合模型的文件收据无效');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`拟合模型读取失败（${response.status}）`);
  const body=await response.arrayBuffer();if(body.byteLength!==bytes)throw new Error('拟合模型文件长度不符');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(digest!==sha256)throw new Error('拟合模型 SHA-256 校验失败');
  const model=decodePrincipalBinary(body);
  if(model.clip_bounds.some((v,i)=>v!==[-50,-50,50,50][i])||model.patches.some(p=>match[3].startsWith('pt-')?p.kind!=='triangle-strip'||p.indices.length!==3:p.kind!=='quadratic-ruled'))throw new Error('拟合模型的裁剪范围或实际曲面类型不符');
  return model;
}

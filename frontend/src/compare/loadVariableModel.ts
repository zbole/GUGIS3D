import {decodePrincipalBinary} from './principalRuledMath.ts';
export async function loadVariableModel(url:string,bytes:number,sha256:string,signal:AbortSignal){
  if(!/^\/research\/variable-curvature-v1\/(published-quartic|anisotropic-quartic)-(00|15|30|45|60|75|90)\/(paper-p1-(8|16|32|64|128|256|512|1024|2048)|hierarchy-p2-(2|4|8|16|32|64|128|256|512|1024|2048)|(?:world-[xy]|mean-hessian)-(1|2|4|8|16|32)x(1|2|4|8|16|32|64|128|256|512))\.bin$/.test(url)
    ||!Number.isSafeInteger(bytes)||bytes<48||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('变曲率模型回执无效');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`变曲率模型读取失败（${response.status}）`);
  const body=await response.arrayBuffer();if(body.byteLength!==bytes)throw new Error('变曲率模型文件长度不符');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(hash!==sha256)throw new Error('变曲率模型 SHA-256 校验失败');
  const model=decodePrincipalBinary(body);if(model.clip_bounds.some((v,i)=>v!==[-50,-50,50,50][i]))throw new Error('变曲率模型覆盖范围已改变');
  const expected=url.includes('/paper-p1-')?'triangle-strip':url.includes('/hierarchy-p2-')?'lagrange-triangle':'quadratic-ruled';
  if(model.patches.some(p=>p.kind!==expected))throw new Error('变曲率模型与方法不符');
  return model;
}

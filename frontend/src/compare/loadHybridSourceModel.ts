import {decodeSourceBandBinary} from './sourceRuledBandMath.ts';
export async function loadHybridSourceModel(url:string,bytes:number,sha256:string,origin:readonly number[],signal:AbortSignal){
  if(!/^\/research\/hybrid-source-v1\/(manchester|york|bath|oxford|cambridge|liverpool|sheffield|leeds|nottingham|newcastle)-(centre|north-quarter)\/(ruled|p1|hybrid)-(1|2|4|8|16|32|64)x(1|2|4|8|16|32|64)\.bin$/.test(url)||!Number.isSafeInteger(bytes)||bytes<204||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256)||origin.length!==2||origin.some(v=>!Number.isFinite(v)))throw new Error('混合源地形回执无效');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`混合源地形读取失败（${response.status}）`);
  const body=await response.arrayBuffer();if(body.byteLength!==bytes)throw new Error('混合源地形文件长度不符');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(digest!==sha256)throw new Error('混合源地形 SHA-256 校验失败');
  const model=decodeSourceBandBinary(body);if(model.origin_bng.some((v,i)=>v!==origin[i])||model.clip_bounds.some((v,i)=>v!==[-32,-32,32,32][i]))throw new Error('混合源地形坐标或覆盖范围不符');
  const dimensions=url.match(/-(\d+)x(\d+)\.bin$/)!;const nx=Number(dimensions[1]),ny=Number(dimensions[2]);
  if(model.points.length!==(nx+1)*(ny+1)||model.points.some((p,i)=>p[0]!==-32+64*(i%(nx+1))/nx||p[1]!==-32+64*Math.floor(i/(nx+1))/ny))throw new Error('混合源地形共享节点布局不符');
  const family=url.slice(url.lastIndexOf('/')+1).split('-')[0];if(model.patches.some(p=>family==='ruled'?p.kind!=='ruled-strip':family==='p1'?p.kind!=='triangle-strip':p.kind!=='ruled-strip'&&p.kind!=='triangle-strip'))throw new Error('混合源地形方法不符');return model;
}

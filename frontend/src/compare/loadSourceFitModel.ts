import {decodeSourceBandBinary} from './sourceRuledBandMath.ts';
import {inspectDiagonalGrid} from './loadDiagonalSourceModel.ts';
export async function loadSourceFitModel(url:string,bytes:number,sha256:string,origin:readonly number[],signal:AbortSignal){
  const match=url.match(/^\/research\/source-global-fit-v1\/(manchester|york|bath|oxford|cambridge|liverpool|sheffield|leeds|nottingham|newcastle)-(centre|north-quarter)\/(p1-fit|ruled-fit|hybrid-fit)-(1|2|4|8|16|32|64)x(1|2|4|8|16|32|64)\.bin$/);
  if(!match||!Number.isSafeInteger(bytes)||bytes<204||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256)||origin.length!==2||origin.some(v=>!Number.isFinite(v)))throw new Error('共享拟合模型的完整收据无效');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`共享拟合模型读取失败（${response.status}）`);
  const body=await response.arrayBuffer();if(body.byteLength!==bytes)throw new Error('共享拟合模型文件长度不符');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(digest!==sha256)throw new Error('共享拟合模型 SHA-256 校验失败');
  const model=decodeSourceBandBinary(body);
  if(model.origin_bng.some((v,i)=>v!==origin[i])||model.clip_bounds.some((v,i)=>v!==[-32,-32,32,32][i]))throw new Error('共享拟合模型坐标原点或范围不符');
  const grid=inspectDiagonalGrid(model,Number(match[4]),Number(match[5]));
  if(match[3]==='p1-fit'&&grid.ruled||match[3]==='ruled-fit'&&grid.ruled!==Number(match[4])*Number(match[5]))throw new Error('共享拟合对照的原生曲面类型不符');
  return model;
}

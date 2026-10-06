import {decodeSourceBandBinary,decodeRegularGridBinary,type SourceBandModel,type RegularHeightGrid} from './sourceRuledBandMath';
export type LoadedSourceModel={kind:'surface';model:SourceBandModel}|{kind:'grid';model:RegularHeightGrid};
export async function loadSourceModel(url:string,bytes:number,sha256:string,origin:readonly number[],signal:AbortSignal):Promise<LoadedSourceModel>{
  const match=/^\/research\/source-native-bands-v1\/(manchester|york|bath|oxford|cambridge|liverpool|sheffield|leeds|nottingham|newcastle)-(centre|north-quarter)\/(ruled|source_p1|source_p2|regular-grid)\.bin$/.exec(url);
  if(!match||!Number.isSafeInteger(bytes)||bytes<80||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256)||origin.length!==2||origin.some(v=>!Number.isFinite(v)))throw new Error('源地形模型回执无效');
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`源地形读取失败（${response.status}）`);
  const body=await response.arrayBuffer();if(body.byteLength!==bytes)throw new Error('源地形文件长度不符');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(hash!==sha256)throw new Error('源地形 SHA-256 校验失败');
  const result:LoadedSourceModel=match[3]==='regular-grid'?{kind:'grid',model:decodeRegularGridBinary(body)}:{kind:'surface',model:decodeSourceBandBinary(body)},m=result.model;
  if(m.clip_bounds.some((v,i)=>v!==[-32,-32,32,32][i])||m.origin_bng.some((v,i)=>v!==origin[i]))throw new Error('源地形坐标或覆盖域已改变');
  if(result.kind==='grid'){if(result.model.width!==65||result.model.height!==65)throw new Error('源栅格尺寸已改变');}
  else{
    const kind=match[3]==='ruled'?'ruled-strip':match[3]==='source_p1'?'triangle-strip':'lagrange-triangle';
    if(result.model.patches.some(p=>p.kind!==kind))throw new Error('源地形函数类型与回执不符');
  }
  return result;
}

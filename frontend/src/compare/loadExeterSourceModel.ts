import {decodeSourceBandBinary,decodeRegularGridBinary,type SourceBandModel,type RegularHeightGrid} from './sourceRuledBandMath';
import {inspectDiagonalGrid} from './loadDiagonalSourceModel';
export type ExeterSourceModel={kind:'surface';model:SourceBandModel}|{kind:'grid';model:RegularHeightGrid};
export async function loadExeterSourceModel(url:string,bytes:number,sha256:string,origin:readonly number[],signal:AbortSignal):Promise<ExeterSourceModel>{
  const match=/^\/research\/exeter-source-fit-v1\/exeter-(centre|north-quarter)\/(?:(p1-fit|ruled-fit|hybrid-fit)-(1|2|4|8|16|32|64)x(1|2|4|8|16|32|64)|(regular-grid))\.bin$/.exec(url);
  if(!match||!Number.isSafeInteger(bytes)||bytes<80||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256)||origin.length!==2||origin.some(v=>!Number.isFinite(v)))throw new Error('新增样区文件回执无效');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const response=await fetch(url,{signal});if(!response.ok||!response.body)throw new Error(`新增样区读取失败（${response.status}）`);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{
    if(signal.aborted)cancel();
    while(true){
      if(signal.aborted)throw new DOMException('取消读取','AbortError');
      const {done,value}=await reader.read();if(signal.aborted)throw new DOMException('取消读取','AbortError');if(done)break;
      length+=value.byteLength;if(length>bytes){await reader.cancel();throw new Error('新增样区文件超过公开长度');}chunks.push(value);
    }
  }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
  if(length!==bytes)throw new Error('新增样区文件不完整');
  const raw=new Uint8Array(length);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(hash!==sha256)throw new Error('新增样区 SHA-256 不符');
  const result:ExeterSourceModel=match[5]?{kind:'grid',model:decodeRegularGridBinary(raw)}:{kind:'surface',model:decodeSourceBandBinary(raw)},model=result.model;
  if(model.origin_bng.some((v,i)=>v!==origin[i])||model.clip_bounds.some((v,i)=>v!==[-32,-32,32,32][i]))throw new Error('新增样区坐标或范围改变');
  if(result.kind==='grid'){if(result.model.width!==65||result.model.height!==65)throw new Error('原始源高程格尺寸改变');}
  else{const nx=Number(match[3]),ny=Number(match[4]),grid=inspectDiagonalGrid(result.model,nx,ny);if(match[2]==='p1-fit'&&grid.ruled||match[2]==='ruled-fit'&&grid.ruled!==nx*ny)throw new Error('新增样区原生类型改变');}
  return result;
}

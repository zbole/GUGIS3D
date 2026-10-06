import {decodeSourceBandBinary,type SourceBandModel} from './sourceRuledBandMath.ts';
export type DiagonalFamily='ruled'|'minus'|'plus';
export function inspectDiagonalGrid(model:SourceBandModel,nx:number,ny:number){
  const axes=[1,2,4,8,16,32,64];
  if(!axes.includes(nx)||!axes.includes(ny)||model.points.length!==(nx+1)*(ny+1)||model.points.some((p,i)=>p[0]!==-32+64*(i%(nx+1))/nx||p[1]!==-32+64*Math.floor(i/(nx+1))/ny))throw new Error('对角线实验的共享节点布局不符');
  const cells=Array<DiagonalFamily|null>(nx*ny).fill(null),runs:{i:number;j:number;length:number;kind:DiagonalFamily}[]=[];
  for(const patch of model.patches){
    let lower:number[],upper:number[],kind:DiagonalFamily;
    if(patch.kind==='ruled-strip'){lower=patch.left;upper=patch.right;kind='ruled';}
    else if(patch.kind==='triangle-strip'&&patch.indices.length%2===0){
      const first=patch.indices.filter((_,i)=>i%2===0),second=patch.indices.filter((_,i)=>i%2===1);
      if(model.points[first[0]][1]<model.points[second[0]][1]){lower=first;upper=second;kind='minus';}else{lower=second;upper=first;kind='plus';}
    }else throw new Error('对角线实验含未批准的曲面类型');
    const start=lower[0],i=start%(nx+1),j=Math.floor(start/(nx+1)),length=lower.length-1;
    if(length<1||j>=ny||i+length>nx||upper.length!==lower.length||lower.some((v,k)=>v!==start+k)||upper.some((v,k)=>v!==start+k+nx+1))throw new Error('直纹面带或三角带的实际索引不符');
    for(let k=0;k<length;k++){const index=j*nx+i+k;if(cells[index]!==null)throw new Error('对角线实验含重复覆盖的单元');cells[index]=kind;}
    runs.push({i,j,length,kind});
  }
  if(cells.some(v=>v===null))throw new Error('对角线实验缺少网格单元');
  return {cells:cells as DiagonalFamily[],runs,ruled:cells.filter(k=>k==='ruled').length,minus:cells.filter(k=>k==='minus').length,plus:cells.filter(k=>k==='plus').length};
}
export async function loadDiagonalSourceModel(url:string,bytes:number,sha256:string,origin:readonly number[],signal:AbortSignal){
  const pattern=/^\/research\/diagonal-hybrid-v1\/(manchester|york|bath|oxford|cambridge|liverpool|sheffield|leeds|nottingham|newcastle)-(centre|north-quarter)\/(p1-local|hybrid-local)-(1|2|4|8|16|32|64)x(1|2|4|8|16|32|64)\.bin$/;
  const match=url.match(pattern);
  if(!match||!Number.isSafeInteger(bytes)||bytes<204||bytes>2_000_000||!/^[a-f0-9]{64}$/.test(sha256)||origin.length!==2||origin.some(v=>!Number.isFinite(v)))throw new Error('对角线实验的文件收据无效');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`对角线模型读取失败（${response.status}）`);
  const body=await response.arrayBuffer();if(body.byteLength!==bytes)throw new Error('对角线模型文件长度不符');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)throw new DOMException('取消读取','AbortError');if(digest!==sha256)throw new Error('对角线模型 SHA-256 校验失败');
  const model=decodeSourceBandBinary(body);
  if(model.origin_bng.some((v,i)=>v!==origin[i])||model.clip_bounds.some((v,i)=>v!==[-32,-32,32,32][i]))throw new Error('对角线模型的坐标原点或范围不符');
  const structure=inspectDiagonalGrid(model,Number(match[4]),Number(match[5]));
  if(match[3]==='p1-local'&&structure.ruled)throw new Error('P1 对照含直纹面带');
  return model;
}

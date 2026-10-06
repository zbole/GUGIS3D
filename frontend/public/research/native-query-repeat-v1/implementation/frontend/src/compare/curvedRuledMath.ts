export type CurvePoint=[number,number,number];
export type CurvePatch={kind:'quadratic-ruled';left:number[];right:number[]}|{kind:'triangle-strip';indices:number[]};
export type CurveModel={format:'gugis-research-surface';version:1;coordinate_system:'LOCAL_METERS';points:CurvePoint[];patches:CurvePatch[]};
export function bezierPoint(points:CurvePoint[],u:number):CurvePoint{
  return [0,1,2].map(k=>(1-u)**2*points[0][k]+2*u*(1-u)*points[1][k]+u*u*points[2][k]) as CurvePoint;
}
export function curvedRuledPoint(model:CurveModel,patch:Extract<CurvePatch,{kind:'quadratic-ruled'}>,u:number,v:number):CurvePoint{
  const a=bezierPoint(patch.left.map(i=>model.points[i]),u),b=bezierPoint(patch.right.map(i=>model.points[i]),u);
  return a.map((z,i)=>z*(1-v)+b[i]*v) as CurvePoint;
}
export function triangleFaces(patch:Extract<CurvePatch,{kind:'triangle-strip'}>){
  return Array.from({length:patch.indices.length-2},(_,i)=>{
    const [a,b,c]=patch.indices.slice(i,i+3);return (i%2?[a,c,b]:[a,b,c]) as [number,number,number];
  });
}
export function validateCurveModel(value:unknown):CurveModel{
  const m=value as CurveModel;
  if(m?.format!=='gugis-research-surface'||m.version!==1||m.coordinate_system!=='LOCAL_METERS'||
    !Array.isArray(m.points)||m.points.length<3||m.points.length>20000||!Array.isArray(m.patches)||m.patches.length<1||m.patches.length>8192)
    throw new Error('研究模型协议或容量无效');
  if(m.points.some(p=>!Array.isArray(p)||p.length!==3||p.some(x=>!Number.isFinite(x)||Math.abs(x)>10000)))throw new Error('研究控制点无效');
  let work=0;
  for(const p of m.patches){
    const ids=p.kind==='triangle-strip'?p.indices:p.kind==='quadratic-ruled'?[...p.left??[],...p.right??[]]:[];
    if(ids.length<3||ids.length>256||ids.some(i=>!Number.isSafeInteger(i)||i<0||i>=m.points.length))throw new Error('研究索引无效');
    if(p.kind==='quadratic-ruled'){
      if(p.left?.length!==3||p.right?.length!==3)throw new Error('二次边界需要各三个控制点');
      const a=p.left.map(i=>m.points[i]),b=p.right.map(i=>m.points[i]);
      const xAxis=Math.abs(a[2][0]-a[0][0])>1e-8;
      const along=xAxis?0:1,across=xAxis?1:0;
      if(a[2][along]<=a[0][along]||b[0][across]<=a[0][across]||
        a.some((q,j)=>Math.abs(q[across]-a[0][across])>1e-10||Math.abs(q[along]-(a[0][along]+j*(a[2][along]-a[0][along])/2))>1e-10)||
        b.some((q,j)=>Math.abs(q[across]-b[0][across])>1e-10||Math.abs(q[along]-a[j][along])>1e-10))throw new Error('研究曲面水平投影须为非折叠矩形');
    }else if(p.kind!=='triangle-strip')throw new Error('未知研究函数');
    work+=ids.length;
  }
  if(work>100000)throw new Error('研究模型查询预算超限');
  return m;
}
export function curveQuery(model:CurveModel,x:number,y:number){
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  for(let index=0;index<model.patches.length;index++){
    const p=model.patches[index];
    if(p.kind==='quadratic-ruled'){
      const a=model.points[p.left[0]],c=model.points[p.left[2]],b=model.points[p.right[0]];
      const along=Math.abs(c[0]-a[0])>1e-8?0:1,across=1-along,xy=[x,y];
      const u=(xy[along]-a[along])/(c[along]-a[along]),v=(xy[across]-a[across])/(b[across]-a[across]);
      if(u>=-1e-12&&u<=1+1e-12&&v>=-1e-12&&v<=1+1e-12){
        const left=p.left.map(i=>model.points[i]),right=p.right.map(i=>model.points[i]);
        const aa=bezierPoint(left,u),bb=bezierPoint(right,u);
        const du=(q:CurvePoint[])=>2*(1-u)*(q[1][2]-q[0][2])+2*u*(q[2][2]-q[1][2]);
        const gradients=[0,0];gradients[along]=((1-v)*du(left)+v*du(right))/(c[along]-a[along]);gradients[across]=(bb[2]-aa[2])/(b[across]-a[across]);
        return {height:aa[2]*(1-v)+bb[2]*v,patch:index,u,v,gradient:gradients,kind:p.kind};
      }
    }else for(const face of triangleFaces(p)){
      const [a,b,c]=face.map(i=>model.points[i]);
      const bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1],det=bx*cy-by*cx;
      if(Math.abs(det)<1e-12)continue;
      const u=((x-a[0])*cy-(y-a[1])*cx)/det,v=(bx*(y-a[1])-by*(x-a[0]))/det;
      if(u>=-1e-12&&v>=-1e-12&&u+v<=1+1e-12)return {height:a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]),patch:index,u,v,
        gradient:[((b[2]-a[2])*cy-(c[2]-a[2])*by)/det,(bx*(c[2]-a[2])-cx*(b[2]-a[2]))/det],kind:p.kind};
    }
  }
  return null;
}

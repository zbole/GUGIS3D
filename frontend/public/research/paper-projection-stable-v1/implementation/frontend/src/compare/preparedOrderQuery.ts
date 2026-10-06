import {nodeOrders,validateOrderModel,type OrderModel,type LagrangePatch} from './terrainOrderMath';

type QueryHit={height:number;gradient:number[];patch:number;u:number;v:number;kind:string};
const powers=[[0,0],[1,0],[0,1],[2,0],[1,1],[0,2],[3,0],[2,1],[1,2],[0,3]] as const;
type Coefficients=number[];
function multiplyLinear(values:Coefficients,constant:number,u:number,v:number){
  const result=Array<number>(10).fill(0);
  for(let i=0;i<powers.length;i++){
    const [a,b]=powers[i];result[i]+=constant*values[i];
    for(const [da,db,factor] of [[1,0,u],[0,1,v]]){
      if(!factor||!values[i])continue;
      const next=powers.findIndex(([x,y])=>x===a+da&&y===b+db);
      if(next<0)throw new Error('研究多项式阶数超限');
      result[next]+=factor*values[i];
    }
  }
  return result;
}
function coefficients(model:OrderModel,patch:LagrangePatch){
  const c=Array<number>(10).fill(0),reference=model.points[patch.nodes[0]][2];c[0]=reference;
  nodeOrders(patch.degree).forEach((alpha,i)=>{
    let basis=Array<number>(10).fill(0);basis[0]=1;
    for(let axis=0;axis<3;axis++)for(let j=0;j<alpha[axis];j++){
      const denominator=alpha[axis]-j,p=patch.degree;
      basis=multiplyLinear(basis,(axis===0?p-j:-j)/denominator,
        (axis===0?-p:axis===1?p:0)/denominator,(axis===0?-p:axis===2?p:0)/denominator);
    }
    const z=model.points[patch.nodes[i]][2]-reference;
    for(let k=0;k<10;k++)c[k]+=z*basis[k];
  });
  return c;
}
function gridForBoxes(bounds:number[],boxes:number[][]){
  if(boxes.length<=8){const indices=boxes.map((_,i)=>i);return {candidates:(_x:number,_y:number)=>indices};}
  const cell=(x:number,axis:number)=>Math.max(0,Math.min(31,Math.floor((x-bounds[axis])*32/(bounds[axis+2]-bounds[axis]))));
  const cells=new Map<number,number[]>();
  boxes.forEach((box,index)=>{
    for(let x=cell(box[0],0);x<=cell(box[2],0);x++)for(let y=cell(box[1],1);y<=cell(box[3],1);y++){
      const key=x+32*y,list=cells.get(key)??[];list.push(index);cells.set(key,list);
    }
  });
  return {candidates:(x:number,y:number)=>cells.get(cell(x,0)+32*cell(y,1))??[]};
}

/** Compile both families once. No per-query model cloning or nodal-basis arrays.
 * The saved nodal representation is unchanged; polynomial coefficients are an
 * execution cache, not an alternative compressed archive or memory claim.
 */
export function prepareOrderQuery(value:OrderModel):{query:(x:number,y:number)=>QueryHit|null}{
  const model=validateOrderModel(value);
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(const p of model.points){bounds[0]=Math.min(bounds[0],p[0]);bounds[1]=Math.min(bounds[1],p[1]);bounds[2]=Math.max(bounds[2],p[0]);bounds[3]=Math.max(bounds[3],p[1]);}
  if(model.patches[0].kind==='quadratic-ruled'){
    const curves=model.patches.map(value=>{
      if(value.kind!=='quadratic-ruled')throw new Error('研究曲面类型混合');
      const a=value.left.map(i=>model.points[i]),b=value.right.map(i=>model.points[i]);
      const along=Math.abs(a[2][0]-a[0][0])>1e-8?0:1,across=1-along;
      const d=b.map((p,i)=>p[2]-a[i][2]);
      return {along,across,origin:[a[0][0],a[0][1]],inverseWidth:1/(a[2][along]-a[0][along]),inverseHeight:1/(b[0][across]-a[0][across]),
        c:[a[0][2],2*(a[1][2]-a[0][2]),a[0][2]-2*a[1][2]+a[2][2],d[0],2*(d[1]-d[0]),d[0]-2*d[1]+d[2]],
        box:[Math.min(a[0][0],a[2][0],b[0][0],b[2][0]),Math.min(a[0][1],a[2][1],b[0][1],b[2][1]),Math.max(a[0][0],a[2][0],b[0][0],b[2][0]),Math.max(a[0][1],a[2][1],b[0][1],b[2][1])]};
    });
    const {candidates}=gridForBoxes(bounds,curves.map(p=>p.box));
    return {query:(x,y)=>{
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<bounds[0]-1e-12||x>bounds[2]+1e-12||y<bounds[1]-1e-12||y>bounds[3]+1e-12)return null;
      for(const index of candidates(x,y)){
        const p=curves[index],u=((p.along===0?x:y)-p.origin[p.along])*p.inverseWidth,v=((p.across===0?x:y)-p.origin[p.across])*p.inverseHeight;
        if(u<-1e-12||u>1+1e-12||v<-1e-12||v>1+1e-12)continue;
        const c=p.c,gradient=[0,0];
        gradient[p.along]=(c[1]+2*u*c[2]+v*(c[4]+2*u*c[5]))*p.inverseWidth;
        gradient[p.across]=(c[3]+u*(c[4]+u*c[5]))*p.inverseHeight;
        return {height:c[0]+u*(c[1]+u*c[2])+v*(c[3]+u*(c[4]+u*c[5])),gradient,patch:index,u,v,kind:'quadratic-ruled'};
      }
      return null;
    }};
  }
  const faces=model.patches.map((value,index)=>{
    const p=value as LagrangePatch,degree=p.degree;
    const [a,b,c]=[0,degree*(degree+1)/2,(degree+1)*(degree+2)/2-1].map(i=>model.points[p.nodes[i]]);
    const bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1],det=bx*cy-by*cx;
    return {a:[a[0],a[1]],inverse:[cy/det,-cx/det,-by/det,bx/det],c:coefficients(model,p),index,
      box:[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1])]};
  });
  const {candidates}=gridForBoxes(bounds,faces.map(f=>f.box));
  const degree=(model.patches[0] as LagrangePatch).degree;
  return {query:(x,y)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<bounds[0]-1e-12||x>bounds[2]+1e-12||y<bounds[1]-1e-12||y>bounds[3]+1e-12)return null;
    for(const i of candidates(x,y)){
      const f=faces[i],dx=x-f.a[0],dy=y-f.a[1],inverse=f.inverse;
      const u=dx*inverse[0]+dy*inverse[1],v=dx*inverse[2]+dy*inverse[3];
      if(u<-1e-12||v<-1e-12||u+v>1+1e-12)continue;
      const c=f.c;
      const height=degree===2?c[0]+u*(c[1]+u*c[3]+v*c[4])+v*(c[2]+v*c[5]):c[0]+u*(c[1]+u*(c[3]+u*c[6])+v*(c[4]+u*c[7]+v*c[8]))+v*(c[2]+v*(c[5]+v*c[9]));
      const du=degree===2?c[1]+2*c[3]*u+c[4]*v:c[1]+2*c[3]*u+c[4]*v+3*c[6]*u*u+2*c[7]*u*v+c[8]*v*v;
      const dv=degree===2?c[2]+c[4]*u+2*c[5]*v:c[2]+c[4]*u+2*c[5]*v+c[7]*u*u+2*c[8]*u*v+3*c[9]*v*v;
      return {height,gradient:[du*inverse[0]+dv*inverse[2],du*inverse[1]+dv*inverse[3]],patch:i,u,v,kind:'lagrange-triangle'};
    }
    return null;
  }};
}

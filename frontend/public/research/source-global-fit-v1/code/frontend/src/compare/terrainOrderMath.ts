import {curveQuery,validateCurveModel,type CurvePoint,type CurvePatch,type CurveModel} from './curvedRuledMath';
export type LagrangePatch={kind:'lagrange-triangle';degree:2|3;nodes:number[]};
export type OrderModel={format:'gugis-research-surface';version:2;coordinate_system:'LOCAL_METERS';points:CurvePoint[];patches:(CurvePatch|LagrangePatch)[]};
export function nodeOrders(degree:number){
  if(degree!==2&&degree!==3)throw new Error('仅支持二次或三次研究三角面');
  const result:number[][]=[];for(let a=degree;a>=0;a--)for(let b=degree-a;b>=0;b--)result.push([a,b,degree-a-b]);return result;
}
export function lagrangeBasis(lambda:number[],degree:2|3){
  return nodeOrders(degree).map(alpha=>{
    const factors=alpha.map((n,axis)=>{
      const f=Array.from({length:n},(_,j)=>(degree*lambda[axis]-j)/(n-j));
      const val=f.reduce((a,b)=>a*b,1);
      const derivative=f.reduce((sum,_,j)=>sum+degree/(n-j)*f.reduce((product,z,k)=>product*(k===j?1:z),1),0);
      return {val,derivative};
    });
    return {value:factors.reduce((a,b)=>a*b.val,1),derivative:factors.map((f,j)=>f.derivative*factors.reduce((product,z,k)=>product*(k===j?1:z.val),1))};
  });
}
function vertices(model:OrderModel,patch:LagrangePatch){
  const p=patch.degree;return [0,p*(p+1)/2,(p+1)*(p+2)/2-1].map(i=>model.points[patch.nodes[i]]);
}
export function validateOrderModel(value:unknown):OrderModel{
  const m=value as OrderModel;
  if(m?.format!=='gugis-research-surface'||m.version!==2||m.coordinate_system!=='LOCAL_METERS'||!Array.isArray(m.points)||!Array.isArray(m.patches)
    ||m.points.length<3||m.points.length>20000||m.patches.length<1||m.patches.length>8192)throw new Error('阶数对照模型协议或容量无效');
  if(m.patches.every(p=>p?.kind==='quadratic-ruled')){validateCurveModel({...m,version:1});return m;}
  if(m.points.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)||Math.abs(v)>10000)))throw new Error('阶数对照节点无效');
  let work=0;const degree=(m.patches[0] as LagrangePatch).degree;
  for(const p of m.patches){
    if(p?.kind!=='lagrange-triangle'||p.degree!==degree||!Array.isArray(p.nodes)||p.nodes.length!==(p.degree+1)*(p.degree+2)/2
      ||p.nodes.some(i=>!Number.isSafeInteger(i)||i<0||i>=m.points.length))throw new Error('阶数对照面片无效');
    const orders=nodeOrders(p.degree),[a,b,c]=vertices(m,p),det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if(det<=1e-12)throw new Error('高阶三角面退化或反向');
    for(let i=0;i<orders.length;i++)for(let k=0;k<2;k++){
      const expected=(a[k]*orders[i][0]+b[k]*orders[i][1]+c[k]*orders[i][2])/p.degree;
      if(Math.abs(m.points[p.nodes[i]][k]-expected)>1e-9)throw new Error('高阶节点位置不符合 Lagrange 约定');
    }
    work+=p.nodes.length;
  }
  if(work>100000)throw new Error('阶数对照计算预算超限');return m;
}
export function decodeOrderBinary(bytes:Uint8Array):OrderModel{
  if(bytes.byteLength<16||bytes.byteLength>1024*1024)throw new Error('阶数二进制档案长度无效');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0;
  const u=()=>{if(offset+4>bytes.byteLength)throw new Error('阶数二进制档案不完整');const n=v.getUint32(offset,true);offset+=4;return n;};
  if(String.fromCharCode(...bytes.slice(0,4))!=='GOC2')throw new Error('阶数二进制标记无效');offset=4;
  const version=u(),np=u(),nk=u();if(version!==2||np<3||np>20000||nk<1||nk>8192||np*24>bytes.byteLength-offset)throw new Error('阶数二进制容量无效');
  const points:CurvePoint[]=[];for(let i=0;i<np;i++){const p=[0,1,2].map(()=>{const n=v.getFloat64(offset,true);offset+=8;return n;}) as CurvePoint;points.push(p);}
  const patches:OrderModel['patches']=[];
  for(let i=0;i<nk;i++){
    const kind=u(),degree=u(),count=u();
    if(!((kind===1&&degree===2&&count===6)||(kind===2&&(degree===2||degree===3)&&count===(degree+1)*(degree+2)/2)))throw new Error('阶数二进制面片标记无效');
    const nodes=Array.from({length:count},()=>u());
    patches.push(kind===1?{kind:'quadratic-ruled',left:nodes.slice(0,3),right:nodes.slice(3)}:{kind:'lagrange-triangle',degree:degree as 2|3,nodes});
  }
  if(offset!==bytes.byteLength)throw new Error('阶数二进制存在多余数据');
  return validateOrderModel({format:'gugis-research-surface',version:2,coordinate_system:'LOCAL_METERS',points,patches});
}
type Grid={bounds:number[];cells:Map<number,number[]>};
const indices=new WeakMap<OrderModel,Grid>();
function indexModel(model:OrderModel):Grid{
  const old=indices.get(model);if(old)return old;
  const bounds=[Math.min(...model.points.map(p=>p[0])),Math.min(...model.points.map(p=>p[1])),Math.max(...model.points.map(p=>p[0])),Math.max(...model.points.map(p=>p[1]))];
  const cell=(x:number,axis:number)=>Math.max(0,Math.min(31,Math.floor((x-bounds[axis])*32/(bounds[axis+2]-bounds[axis]))));
  const cells=new Map<number,number[]>();
  for(let i=0;i<model.patches.length;i++){
    const verts=vertices(model,model.patches[i] as LagrangePatch);
    const xmin=cell(Math.min(...verts.map(v=>v[0])),0),xmax=cell(Math.max(...verts.map(v=>v[0])),0);
    const ymin=cell(Math.min(...verts.map(v=>v[1])),1),ymax=cell(Math.max(...verts.map(v=>v[1])),1);
    for(let x=xmin;x<=xmax;x++)for(let y=ymin;y<=ymax;y++){const key=x+32*y,list=cells.get(key)??[];list.push(i);cells.set(key,list);}
  }
  const index={bounds,cells};indices.set(model,index);return index;
}
export function orderQuery(model:OrderModel,x:number,y:number){
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  if(model.patches[0].kind==='quadratic-ruled')return curveQuery({...model,version:1} as CurveModel,x,y);
  const {bounds,cells}=indexModel(model);if(x<bounds[0]-1e-12||x>bounds[2]+1e-12||y<bounds[1]-1e-12||y>bounds[3]+1e-12)return null;
  const bx=Math.max(0,Math.min(31,Math.floor((x-bounds[0])*32/(bounds[2]-bounds[0])))),by=Math.max(0,Math.min(31,Math.floor((y-bounds[1])*32/(bounds[3]-bounds[1]))));
  for(const index of cells.get(bx+32*by)??[]){
    const p=model.patches[index] as LagrangePatch,[a,b,c]=vertices(model,p),bb=[b[0]-a[0],b[1]-a[1]],cc=[c[0]-a[0],c[1]-a[1]],det=bb[0]*cc[1]-bb[1]*cc[0];
    const u=((x-a[0])*cc[1]-(y-a[1])*cc[0])/det,v=(bb[0]*(y-a[1])-bb[1]*(x-a[0]))/det;
    if(u<-1e-12||v<-1e-12||u+v>1+1e-12)continue;
    const basis=lagrangeBasis([1-u-v,u,v],p.degree),derivative=[0,0,0];let height=0;
    for(let j=0;j<basis.length;j++){const z=model.points[p.nodes[j]][2];height+=z*basis[j].value;for(let k=0;k<3;k++)derivative[k]+=z*basis[j].derivative[k];}
    const du=derivative[1]-derivative[0],dv=derivative[2]-derivative[0];
    return {height,gradient:[(du*cc[1]-dv*bb[1])/det,(dv*bb[0]-du*cc[0])/det],patch:index,u,v,kind:p.kind};
  }
  return null;
}

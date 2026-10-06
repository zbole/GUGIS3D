// Additive research protocol. Existing published v1/v2 kernels stay immutable.
export type PrincipalPoint=[number,number,number];
export type PrincipalPatch={kind:'quadratic-ruled';left:number[];right:number[]}|{kind:'triangle-strip';indices:number[]}|{kind:'lagrange-triangle';degree:2;indices:number[]};
export type PrincipalModel={format:'gugis-research-surface';version:3;coordinate_system:'LOCAL_METERS';clip_bounds:[number,number,number,number];points:PrincipalPoint[];patches:PrincipalPatch[]};
type Primitive={patch:number;kind:PrincipalPatch['kind'];origin:PrincipalPoint;along:PrincipalPoint;across:PrincipalPoint;inverse:number[];coefficients:number[];bounds:number[]};
const LIMIT_BYTES=2_000_000;
export function validatePrincipalModel(value:unknown):PrincipalModel{
  const m=value as PrincipalModel;
  if(m?.format!=='gugis-research-surface'||m.version!==3||m.coordinate_system!=='LOCAL_METERS'||
    !Array.isArray(m.clip_bounds)||m.clip_bounds.length!==4||m.clip_bounds.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)||m.clip_bounds[0]>=m.clip_bounds[2]||m.clip_bounds[1]>=m.clip_bounds[3]||
    !Array.isArray(m.points)||m.points.length<3||m.points.length>20000||m.points.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>!Number.isFinite(n)||Math.abs(n)>10000))||
    !Array.isArray(m.patches)||!m.patches.length||m.patches.length>8192)throw new Error('Invalid principal-surface protocol or capacity');
  let work=0;
  for(const p of m.patches){
    const ids=p?.kind==='quadratic-ruled'&&Array.isArray(p.left)&&Array.isArray(p.right)?[...p.left,...p.right]:(p?.kind==='triangle-strip'||p?.kind==='lagrange-triangle')&&Array.isArray(p.indices)?p.indices:[];
    if(ids.length<3||ids.length>256||ids.some(i=>!Number.isSafeInteger(i)||i<0||i>=m.points.length))throw new Error('Invalid principal-surface indices');
    work+=ids.length;
    if(p.kind==='quadratic-ruled'){
      if(p.left.length!==3||p.right.length!==3)throw new Error('Quadratic boundaries require three nodes');
      const a=p.left.map(i=>m.points[i]),b=p.right.map(i=>m.points[i]);
      const e=[a[2][0]-a[0][0],a[2][1]-a[0][1]],d=[b[0][0]-a[0][0],b[0][1]-a[0][1]],det=e[0]*d[1]-e[1]*d[0];
      if(Math.abs(det)<=1e-12*Math.max(1,Math.hypot(...e)*Math.hypot(...d)))throw new Error('Degenerate or folded horizontal projection');
      for(let j=0;j<3;j++)for(let k=0;k<2;k++)if(Math.abs(a[j][k]-(a[0][k]+j*e[k]/2))>1e-9||Math.abs(b[j][k]-a[j][k]-d[k])>1e-9)throw new Error('Horizontal boundaries must form a parallelogram');
    }else if(p.kind==='lagrange-triangle'){
      if(p.degree!==2||p.indices.length!==6)throw new Error('P2 triangle requires six nodes');
      const nodes=p.indices.map(i=>m.points[i]),a=nodes[0],b=nodes[3],c=nodes[5];
      if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-12)throw new Error('Degenerate P2 triangle');
      for(const [node,left,right] of [[1,0,3],[2,0,5],[4,3,5]])for(let k=0;k<2;k++)if(Math.abs(nodes[node][k]-(nodes[left][k]+nodes[right][k])/2)>1e-9)throw new Error('Invalid P2 node placement');
    }else if(p.kind!=='triangle-strip')throw new Error('Unsupported principal-surface primitive');
    else for(let j=0;j<p.indices.length-2;j++){
      const [a,b,c]=p.indices.slice(j,j+3).map(i=>m.points[i]);
      if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-12)throw new Error('Degenerate triangle');
    }
  }
  if(work>100000)throw new Error('Principal-surface work capacity exceeded');return m;
}
export function preparePrincipalQuery(value:unknown){
  const source=validatePrincipalModel(value),model=JSON.parse(JSON.stringify(source)) as PrincipalModel,primitives:Primitive[]=[];
  const append=(patch:number,kind:PrincipalPatch['kind'],a:PrincipalPoint,c:PrincipalPoint,b:PrincipalPoint,coefficients:number[],corners:PrincipalPoint[])=>{
    const e=c.map((v,k)=>v-a[k]) as PrincipalPoint,d=b.map((v,k)=>v-a[k]) as PrincipalPoint,det=e[0]*d[1]-e[1]*d[0];
    primitives.push({patch,kind,origin:a,along:e,across:d,inverse:[d[1]/det,-d[0]/det,-e[1]/det,e[0]/det],coefficients,bounds:[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))]});
  };
  model.patches.forEach((p,index)=>{
    if(p.kind==='quadratic-ruled'){
      const a=p.left.map(i=>model.points[i]),b=p.right.map(i=>model.points[i]),d=b.map((q,i)=>q[2]-a[i][2]);
      append(index,p.kind,a[0],a[2],b[0],[a[0][2],2*(a[1][2]-a[0][2]),a[0][2]-2*a[1][2]+a[2][2],d[0],2*(d[1]-d[0]),d[0]-2*d[1]+d[2]],[a[0],a[2],b[0],b[2]]);
    }else if(p.kind==='lagrange-triangle'){
      const z=p.indices.map(i=>model.points[i][2]),[a,ab,ac,b,bc,c]=z;
      append(index,p.kind,model.points[p.indices[0]],model.points[p.indices[3]],model.points[p.indices[5]],
        [a,-3*a+4*ab-b,-3*a+4*ac-c,2*a-4*ab+2*b,4*a-4*ab-4*ac+4*bc,2*a-4*ac+2*c],
        [model.points[p.indices[0]],model.points[p.indices[3]],model.points[p.indices[5]]]);
    }else for(let j=0;j<p.indices.length-2;j++){
      const [a,b,c]=p.indices.slice(j,j+3).map(i=>model.points[i]);append(index,p.kind,a,b,c,[a[2],b[2]-a[2],c[2]-a[2]],[a,b,c]);
    }
  });
  const [west,south,east,north]=model.clip_bounds,side=32,cellX=(east-west)/side,cellY=(north-south)/side;
  const cell=(x:number,y:number)=>[Math.min(side-1,Math.max(0,Math.floor((x-west)/cellX))),Math.min(side-1,Math.max(0,Math.floor((y-south)/cellY)))];
  const grid:number[][]=Array.from({length:side*side},()=>[]),indexed=primitives.length>8;
  if(indexed)primitives.forEach((p,i)=>{const [x0,y0]=cell(p.bounds[0],p.bounds[1]),[x1,y1]=cell(p.bounds[2],p.bounds[3]);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)grid[y*side+x].push(i);});
  const all=primitives.map((_,i)=>i);
  const query=(x:number,y:number)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<west||x>east||y<south||y>north)return null;
    const [ix,iy]=cell(x,y),candidates=indexed?grid[iy*side+ix]:all;
    for(const index of candidates){
      const p=primitives[index],dx=x-p.origin[0],dy=y-p.origin[1],u=p.inverse[0]*dx+p.inverse[1]*dy,v=p.inverse[2]*dx+p.inverse[3]*dy;
      if(u<-1e-11||v<-1e-11||u>1+1e-11||v>1+1e-11||(p.kind!=='quadratic-ruled'&&u+v>1+1e-11))continue;
      const a=p.coefficients;
      const height=p.kind==='quadratic-ruled'?a[0]+u*(a[1]+u*a[2])+v*(a[3]+u*(a[4]+u*a[5])):p.kind==='lagrange-triangle'?a[0]+u*a[1]+v*a[2]+u*u*a[3]+u*v*a[4]+v*v*a[5]:a[0]+u*a[1]+v*a[2];
      const du=p.kind==='quadratic-ruled'?a[1]+2*u*a[2]+v*(a[4]+2*u*a[5]):p.kind==='lagrange-triangle'?a[1]+2*u*a[3]+v*a[4]:a[1],dv=p.kind==='quadratic-ruled'?a[3]+u*(a[4]+u*a[5]):p.kind==='lagrange-triangle'?a[2]+u*a[4]+2*v*a[5]:a[2];
      return {height,gradient:[du*p.inverse[0]+dv*p.inverse[2],du*p.inverse[1]+dv*p.inverse[3]],patch:p.patch,primitive:index,kind:p.kind,u,v};
    }
    return null;
  };
  return {query,primitives:primitives.length,indexed};
}
export function encodePrincipalBinary(value:unknown){
  const m=validatePrincipalModel(value),length=48+24*m.points.length+m.patches.reduce((n,p)=>n+12+4*(p.kind==='quadratic-ruled'?6:p.indices.length),0);
  if(length>LIMIT_BYTES)throw new Error('Principal binary capacity exceeded');const b=new ArrayBuffer(length),d=new DataView(b);new Uint8Array(b,0,4).set([71,80,82,51]);
  d.setUint16(4,3,true);d.setUint16(6,1,true);d.setUint32(8,m.points.length,true);d.setUint32(12,m.patches.length,true);m.clip_bounds.forEach((v,i)=>d.setFloat64(16+i*8,v,true));let offset=48;
  for(const p of m.points)for(const n of p){d.setFloat64(offset,n,true);offset+=8;}
  for(const p of m.patches){const ids=p.kind==='quadratic-ruled'?[...p.left,...p.right]:p.indices;d.setUint8(offset,p.kind==='quadratic-ruled'?1:p.kind==='triangle-strip'?2:3);d.setUint8(offset+1,p.kind==='triangle-strip'?1:2);d.setUint32(offset+4,ids.length,true);offset+=12;for(const i of ids){d.setUint32(offset,i,true);offset+=4;}}
  return b;
}
export function decodePrincipalBinary(input:ArrayBuffer|Uint8Array):PrincipalModel{
  const b=input instanceof Uint8Array?input:new Uint8Array(input);
  if(b.byteLength<48||b.byteLength>LIMIT_BYTES)throw new Error('Invalid principal binary length');const d=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(d.getUint32(0,true)!==0x33525047||d.getUint16(4,true)!==3||d.getUint16(6,true)!==1)throw new Error('Invalid principal binary header');
  const np=d.getUint32(8,true),nc=d.getUint32(12,true);
  if(np<3||np>20000||nc<1||nc>8192||48+np*24+nc*24>b.byteLength)throw new Error('Invalid principal binary capacity');
  const points:PrincipalPoint[]=[],patches:PrincipalPatch[]=[],clip_bounds=[0,1,2,3].map(i=>d.getFloat64(16+i*8,true)) as PrincipalModel['clip_bounds'];let offset=48+np*24;
  for(let j=0;j<np;j++)points.push([0,1,2].map(k=>d.getFloat64(48+24*j+8*k,true)) as PrincipalPoint);
  for(let j=0;j<nc;j++){
    if(offset+12>b.byteLength)throw new Error('Truncated principal patch');const kind=d.getUint8(offset),degree=d.getUint8(offset+1),count=d.getUint32(offset+4,true);
    if(d.getUint16(offset+2,true)!==0||d.getUint32(offset+8,true)!==0||count<3||count>256||offset+12+count*4>b.byteLength||!(((kind===1||kind===3)&&degree===2&&count===6)||(kind===2&&degree===1)))throw new Error('Invalid principal patch record');
    const ids=Array.from({length:count},(_,k)=>d.getUint32(offset+12+k*4,true));offset+=12+count*4;
    patches.push(kind===1?{kind:'quadratic-ruled',left:ids.slice(0,3),right:ids.slice(3)}:kind===2?{kind:'triangle-strip',indices:ids}:{kind:'lagrange-triangle',degree:2,indices:ids});
  }
  if(offset!==b.byteLength)throw new Error('Trailing principal data');return validatePrincipalModel({format:'gugis-research-surface',version:3,coordinate_system:'LOCAL_METERS',clip_bounds,points,patches});
}

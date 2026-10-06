// Georeferenced source-window protocol, additive to the immutable GPR3 study.
import {preparePrincipalQuery,validatePrincipalModel,type PrincipalPoint,type PrincipalPatch,type PrincipalModel} from './principalRuledMath.ts';
type Band={kind:'ruled-strip';left:number[];right:number[]};
export type SourceBandModel={format:'gugis-research-surface';version:4;coordinate_system:'LOCAL_METERS';clip_bounds:[number,number,number,number];origin_bng:[number,number];horizontal_epsg:27700;vertical_datum:'ODN';points:PrincipalPoint[];patches:(PrincipalPatch|Band)[]};
export type RegularHeightGrid={clip_bounds:SourceBandModel['clip_bounds'];origin_bng:SourceBandModel['origin_bng'];horizontal_epsg:27700;vertical_datum:'ODN';width:number;height:number;values:Float32Array};
const CAP=2_000_000;
function validateFrame(m:Pick<SourceBandModel,'clip_bounds'|'origin_bng'|'horizontal_epsg'|'vertical_datum'>){
  if(!Array.isArray(m.clip_bounds)||m.clip_bounds.length!==4||m.clip_bounds.some(v=>!Number.isFinite(v)||Math.abs(v)>10000)||m.clip_bounds[0]>=m.clip_bounds[2]||m.clip_bounds[1]>=m.clip_bounds[3]||
    !Array.isArray(m.origin_bng)||m.origin_bng.length!==2||m.origin_bng.some(v=>!Number.isFinite(v)||Math.abs(v)>1e8)||m.horizontal_epsg!==27700||m.vertical_datum!=='ODN')throw new Error('Invalid source BNG / ODN coordinate frame');
}
function expandSourceModel(value:unknown){
  const m=value as SourceBandModel;validateFrame(m);
  if(m.format!=='gugis-research-surface'||m.version!==4||m.coordinate_system!=='LOCAL_METERS'||!Array.isArray(m.points)||m.points.length<3||m.points.length>20000||m.points.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))||!Array.isArray(m.patches)||!m.patches.length||m.patches.length>8192)throw new Error('Invalid source-band protocol capacity');
  const points=m.points.map(p=>[...p] as PrincipalPoint),patches:PrincipalPatch[]=[],bindings:{patch:number;segment:number|null}[]=[];
  const pool=new Map(points.map((p,i)=>[JSON.stringify(p),i]));let work=0;
  const midpoint=(a:PrincipalPoint,b:PrincipalPoint)=>{const p=a.map((v,k)=>(v+b[k])/2) as PrincipalPoint,key=JSON.stringify(p);if(pool.has(key))return pool.get(key)!;if(points.length>=20000)throw new Error('Source execution-point capacity exceeded');pool.set(key,points.length);points.push(p);return points.length-1;};
  m.patches.forEach((p,index)=>{
    if(p.kind==='ruled-strip'){
      if(!Array.isArray(p.left)||!Array.isArray(p.right)||p.left.length!==p.right.length||p.left.length<2||p.left.length>128)throw new Error('Invalid source-band boundary count');
      const ids=[...p.left,...p.right];work+=ids.length;if(ids.some(i=>!Number.isSafeInteger(i)||i<0||i>=m.points.length))throw new Error('Invalid source-band index');
      for(let j=0;j<p.left.length-1;j++){
        const a=p.left[j],c=p.left[j+1],b=p.right[j],d=p.right[j+1];patches.push({kind:'quadratic-ruled',left:[a,midpoint(points[a],points[c]),c],right:[b,midpoint(points[b],points[d]),d]});bindings.push({patch:index,segment:j});
        if(patches.length>8192)throw new Error('Source execution-face capacity exceeded');
      }
    }else{
      if(p.kind!=='quadratic-ruled'&&p.kind!=='triangle-strip'&&p.kind!=='lagrange-triangle')throw new Error('Unsupported source surface');
      work+=p.kind==='quadratic-ruled'?6:p.indices?.length??100001;patches.push(p);bindings.push({patch:index,segment:null});
    }
  });
  if(work>100000)throw new Error('Source index-work capacity exceeded');const native:PrincipalModel={format:m.format,version:3,coordinate_system:m.coordinate_system,clip_bounds:[...m.clip_bounds],points,patches};validatePrincipalModel(native);return {model:m,native,bindings};
}
export function validateSourceBandModel(value:unknown){return expandSourceModel(value).model;}
export function prepareSourceBandQuery(value:unknown){
  const {model,native,bindings}=expandSourceModel(value),prepared=preparePrincipalQuery(native),origin=[...model.origin_bng] as [number,number];
  const query=(x:number,y:number)=>{const q=prepared.query(x,y);if(!q)return null;const binding=bindings[q.patch];return {...q,patch:binding.patch,segment:binding.segment,kind:binding.segment===null?q.kind:'ruled-strip',easting:origin[0]+x,northing:origin[1]+y};};
  return {query,primitives:prepared.primitives,execution_points:native.points.length,stored_points:model.points.length,stored_patches:model.patches.length};
}
function header(m:Pick<SourceBandModel,'clip_bounds'|'origin_bng'|'horizontal_epsg'|'vertical_datum'>,magic:number[],version:number,a:number,b:number,length:number){
  validateFrame(m);if(length>CAP)throw new Error('Source binary capacity exceeded');const out=new ArrayBuffer(length),d=new DataView(out);new Uint8Array(out,0,4).set(magic);d.setUint16(4,version,true);d.setUint16(6,1,true);d.setUint32(8,a,true);d.setUint32(12,b,true);m.clip_bounds.forEach((v,i)=>d.setFloat64(16+8*i,v,true));m.origin_bng.forEach((v,i)=>d.setFloat64(48+8*i,v,true));d.setUint32(64,27700,true);d.setUint16(68,1,true);d.setUint16(70,1,true);return {out,d};
}
function readHeader(input:ArrayBuffer|Uint8Array,magic:number,version:number){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length<80||bytes.length>CAP)throw new Error('Invalid source binary length');const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(d.getUint32(0,true)!==magic||d.getUint16(4,true)!==version||d.getUint16(6,true)!==1||d.getUint32(64,true)!==27700||d.getUint16(68,true)!==1||d.getUint16(70,true)!==1||d.getUint32(72,true)||d.getUint32(76,true))throw new Error('Invalid source binary frame');
  const frame={clip_bounds:[0,1,2,3].map(i=>d.getFloat64(16+8*i,true)) as SourceBandModel['clip_bounds'],origin_bng:[d.getFloat64(48,true),d.getFloat64(56,true)] as SourceBandModel['origin_bng'],horizontal_epsg:27700 as const,vertical_datum:'ODN' as const};validateFrame(frame);return {d,length:bytes.length,frame,a:d.getUint32(8,true),b:d.getUint32(12,true)};
}
export function encodeSourceBandBinary(value:unknown){
  const m=validateSourceBandModel(value),length=80+24*m.points.length+m.patches.reduce((n,p)=>n+12+4*((p.kind==='ruled-strip'||p.kind==='quadratic-ruled')?p.left.length+p.right.length:p.indices.length),0),{out,d}=header(m,[71,80,82,52],4,m.points.length,m.patches.length,length);let offset=80;
  for(const p of m.points)for(const v of p){d.setFloat64(offset,v,true);offset+=8;}
  for(const p of m.patches){const band=p.kind==='ruled-strip',ruled=p.kind==='quadratic-ruled',ids=band||ruled?[...p.left,...p.right]:p.indices;d.setUint8(offset,band?4:ruled?1:p.kind==='triangle-strip'?2:3);d.setUint8(offset+1,band||p.kind==='triangle-strip'?1:2);d.setUint32(offset+4,ids.length,true);offset+=12;for(const i of ids){d.setUint32(offset,i,true);offset+=4;}}
  return out;
}
export function decodeSourceBandBinary(input:ArrayBuffer|Uint8Array):SourceBandModel{
  const {d,length,frame,a:np,b:nc}=readHeader(input,0x34525047,4);
  if(np<3||np>20000||nc<1||nc>8192||80+np*24+nc*24>length)throw new Error('Invalid source binary capacity');const points:PrincipalPoint[]=[],patches:SourceBandModel['patches']=[];let offset=80+24*np;
  for(let i=0;i<np;i++)points.push([0,1,2].map(k=>d.getFloat64(80+24*i+8*k,true)) as PrincipalPoint);
  for(let i=0;i<nc;i++){
    if(offset+12>length)throw new Error('Truncated source record');const kind=d.getUint8(offset),degree=d.getUint8(offset+1),count=d.getUint32(offset+4,true);
    if(d.getUint16(offset+2,true)||d.getUint32(offset+8,true)||count<3||count>256||offset+12+4*count>length||!(((kind===1||kind===3)&&degree===2&&count===6)||(kind===2&&degree===1)||(kind===4&&degree===1&&count>=4&&count%2===0)))throw new Error('Invalid source record');
    const ids=Array.from({length:count},(_,j)=>d.getUint32(offset+12+4*j,true));offset+=12+4*count;
    patches.push(kind===1?{kind:'quadratic-ruled',left:ids.slice(0,3),right:ids.slice(3)}:kind===2?{kind:'triangle-strip',indices:ids}:kind===3?{kind:'lagrange-triangle',degree:2,indices:ids}:{kind:'ruled-strip',left:ids.slice(0,count/2),right:ids.slice(count/2)});
  }
  if(offset!==length)throw new Error('Trailing source bytes');return validateSourceBandModel({format:'gugis-research-surface',version:4,coordinate_system:'LOCAL_METERS',...frame,points,patches});
}
export function encodeRegularGridBinary(grid:RegularHeightGrid){
  if(!Number.isSafeInteger(grid.width)||!Number.isSafeInteger(grid.height)||grid.width<2||grid.height<2||grid.width*grid.height>100000||!(grid.values instanceof Float32Array)||grid.values.length!==grid.width*grid.height||grid.values.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw new Error('Invalid regular height grid');
  const {out,d}=header(grid,[90,71,82,49],1,grid.width,grid.height,80+grid.values.length*4);grid.values.forEach((v,i)=>d.setFloat32(80+4*i,v,true));return out;
}
export function decodeRegularGridBinary(input:ArrayBuffer|Uint8Array):RegularHeightGrid{
  const {d,length,frame,a:width,b:height}=readHeader(input,0x3152475a,1),count=width*height;
  if(width<2||height<2||count>100000||length!==80+4*count)throw new Error('Invalid regular grid capacity');const values=new Float32Array(count);
  for(let i=0;i<count;i++){values[i]=d.getFloat32(80+4*i,true);if(!Number.isFinite(values[i])||Math.abs(values[i])>10000)throw new Error('Invalid regular height');}return {...frame,width,height,values};
}
export function prepareRegularGridQuery(grid:RegularHeightGrid){
  validateFrame(grid);if(!Number.isSafeInteger(grid.width)||!Number.isSafeInteger(grid.height)||grid.width<2||grid.height<2||grid.width*grid.height>100000||!(grid.values instanceof Float32Array)||grid.width*grid.height!==grid.values.length||grid.values.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw new Error('Invalid regular grid');
  const [west,south,east,north]=grid.clip_bounds,width=grid.width,height=grid.height,values=new Float32Array(grid.values),dx=(east-west)/(width-1),dy=(north-south)/(height-1),origin=[...grid.origin_bng];
  const query=(x:number,y:number)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<west||x>east||y<south||y>north)return null;
    const fx=(x-west)/dx,fy=(y-south)/dy,i=Math.min(width-2,Math.max(0,Math.ceil(fx)-1)),j=Math.min(height-2,Math.max(0,Math.ceil(fy)-1)),u=fx-i,v=fy-j;
    const a=values[j*width+i],b=values[j*width+i+1],c=values[(j+1)*width+i],d=values[(j+1)*width+i+1],mixed=a-b-c+d;
    return {height:a+(b-a)*u+(c-a)*v+mixed*u*v,gradient:[(b-a+mixed*v)/dx,(c-a+mixed*u)/dy],column:i,row:j,easting:origin[0]+x,northing:origin[1]+y};
  };return {query};
}

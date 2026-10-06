import {decodeSourceBandBinary,prepareSourceBandQuery} from '../compare/sourceRuledBandMath';
export type RuledTile={id:string;row:number;column:number;filename:string;bytes:number;sha256:string;origin_bng:number[];bounds_bng:number[]};
export type RuledTileIndex={schema:string;bounds_bng:number[];rows:number;columns:number;tile_cells:number;tiles:RuledTile[]};
type Prepared=ReturnType<typeof prepareSourceBandQuery>;
const base='/research/ruled-terrain-tiles-v1/';
const abortError=()=>new DOMException('已取消瓦片查询','AbortError');
export function createRuledTileQuery(index:RuledTileIndex,{limit=8,fetcher=async(url:string,signal:AbortSignal)=>{const response=await fetch(url,{signal});if(!response.ok)throw new Error('原生地形瓦片读取失败（'+response.status+'）');return response.arrayBuffer();}}={}){
  if(index.schema!=='gugis-ruled-terrain-tiles-v1'||index.rows!==8||index.columns!==8||index.tile_cells!==64||index.bounds_bng.length!==4||index.bounds_bng.some(v=>!Number.isFinite(v))||index.bounds_bng[2]-index.bounds_bng[0]!==512||index.bounds_bng[3]-index.bounds_bng[1]!==512||index.tiles.length!==64||!Number.isInteger(limit)||limit<1||limit>16)throw new Error('原生地形瓦片索引无效');
  const bounds=[...index.bounds_bng],tiles=index.tiles.map((t,k)=>{
    const row=Math.floor(k/8),column=k%8,origin=[bounds[0]+32+64*column,bounds[1]+32+64*row],expectedBounds=[origin[0]-32,origin[1]-32,origin[0]+32,origin[1]+32],filename='tiles/row-'+String(row).padStart(2,'0')+'-col-'+String(column).padStart(2,'0')+'.bin';
    if(t.row!==row||t.column!==column||t.id!=='r'+row+'c'+column||t.filename!==filename||t.bytes!==135528||!/^[a-f0-9]{64}$/.test(t.sha256)||t.origin_bng.length!==2||t.origin_bng.some((v,i)=>v!==origin[i])||t.bounds_bng.length!==4||t.bounds_bng.some((v,i)=>v!==expectedBounds[i]))throw new Error('原生地形瓦片布局或回执无效');
    return {...t,origin_bng:origin,bounds_bng:expectedBounds};
  });
  const ready=new Map<string,{tile:RuledTile;prepared:Prepared}>();let disposed=false,requests=0,validatedBytes=0;
  const check=(signal:AbortSignal)=>{if(disposed||signal.aborted)throw abortError();};
  const tileFor=(easting:number,northing:number)=>{
    if(!Number.isFinite(easting)||!Number.isFinite(northing)||easting<bounds[0]||easting>bounds[2]||northing<bounds[1]||northing>bounds[3])return null;
    // Boundary ownership is the lowest source row/column, consistent with the
    // whole source-grid one-sided derivative convention.
    const column=Math.max(0,Math.min(7,Math.ceil((easting-bounds[0])/64)-1)),row=Math.max(0,Math.min(7,Math.ceil((northing-bounds[1])/64)-1));
    return tiles[row*8+column];
  };
  const query=async(easting:number,northing:number,signal:AbortSignal=new AbortController().signal)=>{
    check(signal);const tile=tileFor(easting,northing);if(!tile)return null;
    let cached=ready.get(tile.id);
    if(cached){ready.delete(tile.id);ready.set(tile.id,cached);}
    else{
      requests++;const body=await fetcher(base+tile.filename,signal);check(signal);
      if(body.byteLength!==tile.bytes)throw new Error('原生地形瓦片长度不符');
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),v=>v.toString(16).padStart(2,'0')).join('');check(signal);
      if(digest!==tile.sha256)throw new Error('原生地形瓦片 SHA-256 不符');
      const model=decodeSourceBandBinary(body);
      if(model.origin_bng.some((v,i)=>v!==tile.origin_bng[i])||model.clip_bounds.some((v,i)=>v!==[-32,-32,32,32][i])||model.points.length!==4225||model.patches.length!==64||model.patches.some(p=>p.kind!=='ruled-strip'))throw new Error('原生地形瓦片坐标或函数类型不符');
      cached={tile,prepared:prepareSourceBandQuery(model)};check(signal);ready.delete(tile.id);ready.set(tile.id,cached);validatedBytes+=body.byteLength;
      while(ready.size>limit)ready.delete(ready.keys().next().value!);
    }
    check(signal);const point=cached.prepared.query(easting-tile.origin_bng[0],northing-tile.origin_bng[1]);
    if(!point)throw new Error('原生地形瓦片未覆盖索引承诺的点');
    return {...point,tile_id:tile.id,tile_row:tile.row,tile_column:tile.column,tile_bytes:tile.bytes};
  };
  return {query,tileFor,stats:()=>({ready_tiles:ready.size,ready_file_bytes:[...ready.values()].reduce((n,v)=>n+v.tile.bytes,0),requests,validated_file_bytes:validatedBytes,limit}),dispose:()=>{disposed=true;ready.clear();}};
}

import catalogue from '../../../shared/public-terrain-sources-v8.json';
import type {Terrain} from '../studio/environment';

export async function loadPublicTerrain(cityId:string,signal:AbortSignal,apiBase='/api'):Promise<Terrain>{
  const source=catalogue.sources.find(s=>s.city_id===cityId);
  if(!source||!['bristol','london','birmingham','manchester','york','bath','oxford','cambridge','liverpool','sheffield','leeds','nottingham','newcastle'].includes(cityId)||source.model_bytes>8*1024*1024)throw new Error('当前城市无已核验的公开地形。');
  const expected=source.model_bytes+12;
  const response=await fetch(`${apiBase.replace(/\/$/,'')}/cities/${cityId}/city/terrain/public-preview`,{signal});
  if(!response.ok||!response.body)throw new Error('公开地形读取失败；没有修改城市。');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let received=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;
      if(received>expected){await reader.cancel();throw new Error('公开预览超出已发布长度。');}chunks.push(value);}
  }finally{reader.releaseLock();}
  if(received!==expected)throw new Error('公开预览不完整。');
  const body=new Uint8Array(received);let offset=0;
  for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  if(new TextDecoder().decode(body.subarray(0,11))!=='{"terrain":'||body[body.length-1]!==125)throw new Error('公开预览响应与发布协议不符。');
  const content=body.subarray(11,-1);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==source.model_sha256)throw new Error('公开预览哈希与当前数据集不符，请刷新后重试。');
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const terrain=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content)) as Terrain;
  // Exact bytes belong to backend-validated published data. Keep a cheap final
  // identity gate here; this loader never accepts arbitrary user model URLs.
  if(terrain.demonstration||terrain.vertical_datum!=='ODN'||terrain.points.length!==source.preview_points||terrain.patches.some(p=>p.kind!=='ruled-strip'&&p.kind!=='triangle-strip'))throw new Error('公开地形身份与采样结构不符。');
  return terrain;
}

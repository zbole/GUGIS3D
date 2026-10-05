import protocol from '../../../shared/bristol-arcgis-protocol.json';

export const ARCGIS_RESULT_LIMIT=128*1024;
export type ArcGISRow={id:string;read_ms:number[];copy_ms:number[];copy_output_bytes:number[];median_read_ms:number;median_copy_ms:number};
export type ArcGISReceipt={schema:string;measured_at_utc:string;runtime:{product:string;version:string;license:string;python:string;os:string;processor:string};results:ArcGISRow[]};
function fail(message:string):never{throw new Error(message);}
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail('结果应为 JSON 对象。');
const label=(value:unknown,allowEmpty=false):string=>typeof value==='string'&&value.length<=256&&(allowEmpty||value.trim().length>0)&&!/[\u0000-\u001f]/.test(value)?value:fail('运行环境字段缺失或格式错误。');
const samples=(value:unknown,bytes=false):number[]=>Array.isArray(value)&&value.length===5&&value.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=(bytes?2**31:3600000)&&(!bytes||Number.isSafeInteger(v)))?value:fail('每项操作应包含五个有效的重复测量。');
export function sampleMedian(values:number[]){return [...values].sort((a,b)=>a-b)[2];}

/** Identity/format validation of operator-supplied data, not execution attestation. */
export function validateBristolArcGISReceipt(value:unknown):ArcGISReceipt{
  const r=object(value);
  if(r.schema!=='gugis-bristol-arcgis-run-v1'||r.manifest_sha256!==protocol.manifest_sha256||r.runner_sha256!==protocol.runner_sha256)fail('结果属于其他数据包或测试脚本，请使用当前六样区测试包。');
  if(r.repeats!==5||r.cache_policy!=='one-process-one-warmup-per-operation-five-repeats-no-cold-cache-guarantee'||JSON.stringify(r.operations)!==JSON.stringify(['SearchCursor-SHAPE@-and-SAMPLE_ID','CopyFeatures-to-new-FGDB']))fail('测试任务、预热或重复次数与当前协议不一致。');
  const date=label(r.measured_at_utc);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(date)||!Number.isFinite(Date.parse(date)))fail('测量时间应为有效 UTC 时间。');
  const runtime=object(r.runtime);
  const info={product:label(runtime.product),version:label(runtime.version),license:label(runtime.license),python:label(runtime.python),os:label(runtime.os),processor:label(runtime.processor,true)};
  if(info.product!=='ArcGISPro'||['Unavailable','NotInitialized'].includes(info.license))fail('结果未声明已初始化的 ArcGIS Pro 环境。');
  if(!Array.isArray(r.results)||r.results.length!==6)fail('必须提供两个真实样区、三档目标的完整六组结果。');
  const seen=new Set<string>();
  const results=r.results.map(value=>{
    const row=object(value),model=protocol.models.find(m=>m.id===row.id);
    if(!model||seen.has(model.id))fail('样区重复或不属于当前测试包。');
    seen.add(model.id);
    if(row.native_sha256!==model.native_sha256||row.geometry_sha256!==model.geometry_sha256||row.coordinate_sha256!==model.coordinate_sha256)fail('模型或几何哈希不匹配。');
    if(row.feature_count!==1||row.vertex_count!==model.multipatch_vertices||row.horizontal_wkid!==27700||row.has_z!==true||row.source_coordinates_identical!==true||row.copy_coordinates_identical!==true)fail('ArcGIS 几何或坐标核对未通过。');
    const reads=samples(row.read_ms),copies=samples(row.copy_ms),sizes=samples(row.copy_output_bytes,true);
    const readMedian=sampleMedian(reads),copyMedian=sampleMedian(copies);
    if(typeof row.median_read_ms!=='number'||typeof row.median_copy_ms!=='number'||!Number.isFinite(row.median_read_ms)||!Number.isFinite(row.median_copy_ms)||Math.abs(row.median_read_ms-readMedian)>1e-9||Math.abs(row.median_copy_ms-copyMedian)>1e-9)fail('中位数与五次原始记录不一致。');
    return {id:model.id,read_ms:reads,copy_ms:copies,copy_output_bytes:sizes,median_read_ms:readMedian,median_copy_ms:copyMedian};
  });
  return {schema:String(r.schema),measured_at_utc:date,runtime:info,results};
}

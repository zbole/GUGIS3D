import manifest from '../../../shared/bristol-viewer-models.json';
export type BristolModel=(typeof manifest.models)[number];
export const bristolModelNames={local_compact:'新局部紧凑混合',global_compact:'原全局紧凑混合',local_triangles:'局部三角带'};
export const bristolModelKey=(m:BristolModel)=>`${m.case_id}/${m.family}/${m.target_m}`;
export function feasibleBristolModels(records:BristolModel[],maxM:number,rmseM:number|null){
  if(!Number.isFinite(maxM)||maxM<=0||(rmseM!==null&&(!Number.isFinite(rmseM)||rmseM<=0)))return [];
  return records.filter(m=>m.continuous_bound_m<=maxM&&(rmseM===null||m.rmse_m<=rmseM))
    .sort((a,b)=>a.bytes-b.bytes||a.continuous_bound_m-b.continuous_bound_m||a.rmse_m-b.rmse_m||bristolModelKey(a).localeCompare(bristolModelKey(b)));
}
// Joint finite frontier: a candidate is dominated only by an actually published
// model no larger and no worse on BOTH measured errors, with a strict gain.
export function bristolFrontier(records:BristolModel[]){
  return records.filter(m=>!records.some(n=>n!==m&&n.bytes<=m.bytes&&n.continuous_bound_m<=m.continuous_bound_m&&n.rmse_m<=m.rmse_m
    &&(n.bytes<m.bytes||n.continuous_bound_m<m.continuous_bound_m||n.rmse_m<m.rmse_m)))
    .map(bristolModelKey);
}

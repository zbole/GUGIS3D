export type IntegralCandidate={bytes:number;e2_m2:number;continuous_bound_m:number;sha256:string};

export function selectIntegralCandidates<T extends IntegralCandidate>(candidates:readonly T[],maximumM:number,e2Limit:number|null):T[]{
  if(!Number.isFinite(maximumM)||maximumM<=0||e2Limit!==null&&(!Number.isFinite(e2Limit)||e2Limit<=0))return [];
  return candidates.filter(m=>Number.isFinite(m.bytes)&&m.bytes>0&&Number.isFinite(m.e2_m2)&&m.e2_m2>=0
    &&Number.isFinite(m.continuous_bound_m)&&m.continuous_bound_m>=0&&m.continuous_bound_m<=maximumM
    &&(e2Limit===null||m.e2_m2<=e2Limit)).sort((a,b)=>a.bytes-b.bytes||a.e2_m2-b.e2_m2||a.continuous_bound_m-b.continuous_bound_m||a.sha256.localeCompare(b.sha256));
}

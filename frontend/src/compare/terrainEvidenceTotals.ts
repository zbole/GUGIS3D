import {terrainTradeoff} from './terrainRepresentationDecision';

type Model={family:string;target_m:number;bytes:number;e2_m2:number;target_met:boolean;integrated_area_m2:number;ruled_quads:number;multipatch?:{five_component_bytes:number;exact_xyz_and_parts:boolean;files:{bytes:number}[]}};
type Report={cases:{id:string;city_id:string;models:Model[]}[]};
export function terrainEvidenceTotals(reports:Report[],target:number){
  if(![.1,.25,.5].includes(target))throw new Error('Unsupported evidence target');
  const seen=new Set<string>();
  const rows=reports.flatMap(report=>report.cases.map(c=>{
    if(seen.has(c.id))throw new Error('Duplicate evidence site');seen.add(c.id);
    const triangles=c.models.filter(m=>m.family==='local_triangles'&&m.target_m===target);
    const candidates=c.models.filter(m=>m.family==='hybrid'&&m.target_m===target);
    if(triangles.length!==1||candidates.length!==1)throw new Error('Incomplete evidence pair');
    const t=triangles[0],h=candidates[0],mp=t.multipatch;
    if(!mp?.exact_xyz_and_parts||mp.files.length!==5||!mp.files.every(f=>Number.isSafeInteger(f.bytes)&&f.bytes>0)||mp.files.reduce((n,f)=>n+f.bytes,0)!==mp.five_component_bytes)throw new Error('Unverified five-component geometry');
    for(const m of [t,h])if(!Number.isSafeInteger(m.bytes)||m.bytes<=0||!Number.isFinite(m.e2_m2)||m.e2_m2<0||!m.target_met||m.integrated_area_m2!==4096||!Number.isSafeInteger(m.ruled_quads)||m.ruled_quads<0)throw new Error('Unverified domain or model');
    return {id:c.id,city:c.city_id,triangleBytes:t.bytes,multipatchBytes:mp.five_component_bytes,candidateBytes:h.bytes,ruledQuads:h.ruled_quads,verdict:terrainTradeoff(t,h)};
  }));
  if(!rows.length)throw new Error('No evidence sites');
  const triangleBytes=rows.reduce((n,r)=>n+r.triangleBytes,0),multipatchBytes=rows.reduce((n,r)=>n+r.multipatchBytes,0);
  return {rows,siteCount:rows.length,cityCount:new Set(rows.map(r=>r.city)).size,triangleBytes,multipatchBytes,
    formatSavingPercent:100*(1-triangleBytes/multipatchBytes),
    mixedDominates:rows.filter(r=>r.verdict==='mixed-dominates').length,
    trianglesDominate:rows.filter(r=>r.verdict==='triangles-dominates').length,
    tradeoffs:rows.filter(r=>r.verdict==='tradeoff').length,equal:rows.filter(r=>r.verdict==='equal').length,
    ruledQuads:rows.reduce((n,r)=>n+r.ruledQuads,0),withRuled:rows.filter(r=>r.ruledQuads>0).length};
}

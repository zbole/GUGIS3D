type Result = {bytes:number;e2_m2:number;target_met:boolean};
export function terrainTradeoff(triangles:Result,mixed:Result){
  if(![triangles.bytes,mixed.bytes,triangles.e2_m2,mixed.e2_m2].every(Number.isFinite)||
    triangles.bytes<=0||mixed.bytes<=0||triangles.e2_m2<0||mixed.e2_m2<0||
    !triangles.target_met||!mixed.target_met)return 'incomplete';
  const epsilon=1e-10*Math.max(1,triangles.e2_m2,mixed.e2_m2);
  const error=mixed.e2_m2-triangles.e2_m2,bytes=mixed.bytes-triangles.bytes;
  if(bytes===0&&Math.abs(error)<=epsilon)return 'equal';
  if(bytes<=0&&error<=epsilon)return 'mixed-dominates';
  if(bytes>=0&&error>=-epsilon)return 'triangles-dominates';
  return 'tradeoff';
}
export const tradeoffText={
  'mixed-dominates':'本档局部分区在文件体积与全域 E₂ 上同时不劣，可优先作为候选。',
  'triangles-dominates':'本档原生三角带在文件体积与全域 E₂ 上同时不劣，可优先作为候选。',
  'tradeoff':'本档存在精度与体积取舍：更小的文件没有同时取得更低的全域 E₂。',
  'equal':'本档两种表示的文件体积与全域 E₂ 相同。',
  'incomplete':'本档结果未完整达标，暂不作表示优劣判断。',
};

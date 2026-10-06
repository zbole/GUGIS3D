"""Derive three primary result stories and two file-format results from exact evidence."""
import argparse,json
from build_advantage_summary import ROOT,sha,derive as old_advantages
OUTPUT=ROOT/'shared/result-focus-v1.json'
def derive():
    old=old_advantages();inputs=list(old['inputs'])
    def load(name,folder):
        relative='shared/'+name;raw=(ROOT/relative).read_bytes();r=json.loads(raw);inputs.append({'path':relative,'sha256':sha(raw)})
        path='frontend/public/research/'+folder+'/results.json';raw=(ROOT/path).read_bytes()
        if sha(raw)!=r['report_sha256']:raise ValueError('Immutable result changed')
        inputs.append({'path':path,'sha256':sha(raw)});package=r['package'];path='frontend/public/research/'+folder+'/'+package['filename'];b=(ROOT/path).read_bytes()
        if sha(b)!=package['sha256'] or len(b)!=package['bytes']:raise ValueError('Actual package changed')
        inputs.append({'path':path,'sha256':sha(b)})
        return r
    variable=load('variable-curvature-display-v1.json','variable-curvature-v1');hybrid=load('hybrid-source-display-v1.json','hybrid-source-v1');cpu=load('native-query-repeat-display-v1.json','native-query-repeat-v1')
    def evidence(r,folder,anchor):return {'report_sha256':r['report_sha256'],'detail_href':'#'+anchor,'package_url':'/research/'+folder+'/'+r['package']['filename'],'package_bytes':r['package']['bytes'],'package_sha256':r['package']['sha256']}
    directional=[p for c in variable['cases'] if c['field']['id']=='anisotropic-quartic' for p in c['pairs']];other=[p for c in variable['cases'] if c['field']['id']=='published-quartic' for p in c['pairs']]
    reductions=[100*(1-p['mean_hessian']['e2_m2']/p['p1']['e2_m2']) for p in directional]
    pair=next(c for c in variable['cases'] if c['id']=='anisotropic-quartic-30')['pairs'][-1]
    if pair['budget']!=2048 or any(p['mean_hessian']['binary_bytes']>p['p1']['binary_bytes'] for p in directional):raise ValueError('Headline N/file budget differs')
    a,b,control=pair['p1'],pair['mean_hessian'],pair['p2'];selected=[next(p for p in c['byte_pairs'] if p['byte_ceiling']==8192) for c in hybrid['cases']]
    if any(p['byte_ceiling']!=8192 for p in selected):raise ValueError('Real-source headline ceiling changed')
    source_reductions=[100*(1-p['hybrid']['e2_m2']/p['p1']['e2_m2']) for p in selected]
    all_pairs=[p for c in hybrid['cases'] for p in c['byte_pairs']];ratios=[v['ratio'] for c in cpu['cases'] for v in c['repetitions']]
    stories=[{'id':'variable-paper','category':'论文式 P1 精度','headline':'方向变化后，依然更低误差','value':100*(1-b['e2_m2']/a['e2_m2']),'unit':'%','value_note':'全域 E₂ 降低','context':'强方向性四次曲面 · 30° · N=2,048','baseline':'论文式 L₂ 贪心 P1 / L₁ 选边 · 同 N 与完整文件预算','coverage':f'{sum(v>0 for v in reductions)}/{len(reductions)} 组有收益；全档降幅 {min(reductions):.2f}%–{max(reductions):.2f}%',
      'metrics':[{'label':'论文式 P1','value':a['e2_m2'],'unit':'m² E₂','tone':'reference'},{'label':'GUGIS 面带','value':b['e2_m2'],'unit':'m² E₂','tone':'gugis'},{'label':'P₂ 控制','value':control['e2_m2'],'unit':'m² E₂','tone':'control'}],
      'controls':f'另一四次曲面仅 {sum(p["mean_hessian"]["e2_m2"]<p["p1"]["e2_m2"] for p in other)}/{len(other)} 组获益；当前 P₂ 控制误差更低。',**evidence(variable,'variable-curvature-v1','variable-curvature-results')},
      {'id':'real-hybrid','category':'真实 DTM 混合','headline':'面带与三角带，共享边界','value':sum(v>0 for v in source_reductions),'unit':'/20','value_note':'固定预算下误差更低','context':'十城二十固定 1 m 源样区 · 完整文件 ≤ 8,192 B','baseline':'同源 Float32 双线性函数 · 本次固定网格 P1 三角带','coverage':f'E₂ 降低 {min(source_reductions):.2f}%–{max(source_reductions):.2f}%；全部十档 {sum(p["hybrid"]["e2_m2"]<p["p1"]["e2_m2"] for p in all_pairs)}/{len(all_pairs)} 组更低',
      'points':[{'id':c['id'],'name':c['name'],'reduction_percent':v} for c,v in zip(hybrid['cases'],source_reductions)],
      'controls':'共享线性边界保持 C⁰；额外混合记录计入文件。固定网格对照与论文贪心 P1 分开。',**evidence(hybrid,'hybrid-source-v1','hybrid-source-results')},
      {'id':'cpu-repeat','category':'独立 CPU 复测','headline':'换三个新进程，重新测量','value':sum(v>1 for v in ratios),'unit':'/15','value_note':'耗时中位数对比有收益','context':'五个固定同函数样例 · 三次新 Node 进程','baseline':'相同函数的 P₂ / P₃ 三角查询 · 同点定位、高程与解析梯度','coverage':f'完整范围 {min(ratios):.3f}–{max(ratios):.3f}×；保留全部 {cpu["prepared_pairs"]} 对准备后测量',
      'points':[{'id':c['id'],'name':c['name'],'minimum':c['minimum_ratio'],'maximum':c['maximum_ratio']} for c in cpu['cases']],
      'controls':'本机 i7-14650HX / Node v24.13.0。三次范围不是置信区间，也不代表 GPU 或 ArcGIS 软件性能。',**evidence(cpu,'native-query-repeat-v1','native-query-repeat')}]
    secondary=[c for c in old['claims'] if c['id'] in ['source-function','multipatch-format']]
    return {'schema':'gugis-result-focus-v1','inputs':inputs,'stories':stories,'secondary':secondary}
def body():return (json.dumps(derive(),ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args();b=body()
    if args.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Focused result manifest differs from immutable evidence')
    else:
        if OUTPUT.exists():raise FileExistsError('Focused result version cannot be overwritten')
        OUTPUT.write_bytes(b)
    print(f'Three result stories and two format benefits verified: {len(b)} bytes')

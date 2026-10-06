"""Derive results-first cards from stronger, already audited controls; keep v1 intact."""
import argparse,json
from build_result_focus import ROOT,sha,derive as previous_focus
OUTPUT=ROOT/'shared/result-focus-v2.json'

def derive():
    old=previous_focus();inputs=list(old['inputs'])
    def load(name,folder):
        relative='shared/'+name;raw=(ROOT/relative).read_bytes();r=json.loads(raw)
        inputs.append({'path':relative,'sha256':sha(raw)})
        path='frontend/public/research/'+folder+'/results.json';b=(ROOT/path).read_bytes()
        if sha(b)!=r['report_sha256']:raise ValueError('Immutable stronger result changed')
        inputs.append({'path':path,'sha256':sha(b)})
        p=r['package'];path='frontend/public/research/'+folder+'/'+p['filename'];b=(ROOT/path).read_bytes()
        if sha(b)!=p['sha256'] or len(b)!=p['bytes']:raise ValueError('Stronger complete package changed')
        inputs.append({'path':path,'sha256':sha(b)})
        return r
    fitted=load('paper-projection-ui-v1.json','paper-projection-stable-v1')
    real=load('diagonal-hybrid-ui-v1.json','diagonal-hybrid-v1')
    for r,name in [(fitted,'paper-projection-display-v1.json'),(real,'diagonal-hybrid-display-v1.json')]:
        raw=(ROOT/'shared'/name).read_bytes()
        if sha(raw)!=r['source_summary_sha256']:raise ValueError('Compact view is not bound to published source')
        inputs.append({'path':'shared/'+name,'sha256':sha(raw)})
    raw=(ROOT/'shared/paper-projection-prototype-audit-v1.json').read_bytes()
    if sha(raw)!=fitted['prototype_audit_summary_sha256']:raise ValueError('Prototype failure disclosure changed')
    inputs.append({'path':'shared/paper-projection-prototype-audit-v1.json','sha256':sha(raw)})
    def evidence(r,folder,anchor):
        return {'report_sha256':r['report_sha256'],'detail_href':'#'+anchor,'package_url':'/research/'+folder+'/'+r['package']['filename'],'package_bytes':r['package']['bytes'],'package_sha256':r['package']['sha256']}
    def pairs(field):
        return [(c,c['models'][p['fitted']],c['models'][p['pt']],c['models'][p['before']]) for c in fitted['cases'] if c['field']['id']==field for p in c['pairs']]
    strong=pairs('anisotropic-quartic');other=pairs('published-quartic')
    all_pairs=strong+other
    if len(all_pairs)!=126 or any(b['binary_bytes']!=a['binary_bytes'] for c,b,t,a in all_pairs):raise ValueError('Same-space model topology/cost scope changed')
    c=next(c for c in fitted['cases'] if c['id']=='anisotropic-quartic-30');p=next(p for p in c['pairs'] if p['budget']==2048)
    entries={key:c['models'][p[key]] for key in ['p1','pt','before','fitted','p2']};b=entries['fitted'];t=entries['pt'];a=entries['before'];drop=lambda x,y:100*(1-x/y)
    reductions=[drop(b['e2_m2'],t['e2_m2']) for c,b,t,a in strong]
    paper={'id':'variable-paper','category':'论文允许的 Pₜ 强控制','headline':'共享系数拟合，降低误差','value':drop(b['e2_m2'],t['e2_m2']),'unit':'%','value_note':'相对固定网格 Pₜ 的全域 E₂ 降低','context':'强各向异性四次曲面 · 30° · N=2,048','baseline':'原插值贪心网格上逐三角形 L₂ 投影 Pₜ · 并非完整 Pₜ 驱动自适应算法',
      'coverage':f'{sum(v>0 for v in reductions)}/{len(reductions)} 组低于 Pₜ；默认同空间拟合降低 {drop(b["e2_m2"],a["e2_m2"]):.2f}%，{a["binary_bytes"]:,} B 不变。',
      'metrics':[{'label':label,'value':entries[key]['e2_m2'],'unit':'m2 E₂','tone':tone} for key,label,tone in [('p1','原 P1','reference'),('pt','投影 Pₜ','reference'),('before','原面带','reference'),('fitted','拟合面带','gugis'),('p2','P₂ 控制','control')]],
      'controls':f'另一四次曲面仅 {sum(b["e2_m2"]<t["e2_m2"] for c,b,t,a in other)}/{len(other)} 组优于 Pₜ；强各向异性 30°/N=64 仍不利。当前 P₂ 更准确；保留全部结果。',**evidence(fitted,'paper-projection-stable-v1','paper-projection-results')}
    selected=[next(p for p in c['byte_pairs'] if p['byte_ceiling']==8192) for c in real['cases']]
    reductions=[drop(c['models'][p['hybrid-local']]['e2_m2'],c['models'][p['p1-local']]['e2_m2']) for c,p in zip(real['cases'],selected)]
    all_real=[(c,p) for c in real['cases'] for p in c['byte_pairs']]
    wins=sum(c['models'][p['hybrid-local']]['e2_m2']<c['models'][p['p1-local']]['e2_m2'] for c,p in all_real)
    source={'id':'real-hybrid','category':'真实 DTM · 双对角线强控制','headline':'双对角线对照下仍有收益','value':sum(v>0 for v in reductions),'unit':'/20','value_note':'8,192 B 上限下全部样区更准确','context':'十城二十固定 1 m 源窗口 · 完整文件上限 8,192 B','baseline':'P1 逐格择优两条对角线；混合逐格择优直纹 / 两条三角对角线',
      'coverage':f'E₂ 降低 {min(reductions):.4f}%–{max(reductions):.4f}%；全部十档预算 {wins}/{len(all_real)} 组更低。',
      'points':[{'id':c['id'],'name':c['name'],'reduction_percent':v} for c,v in zip(real['cases'],reductions)],
      'controls':'同完整文件上限，实际文件大小可以不同；所有方向记录和索引计入。共享边界 C⁰；固定网格，非论文自适应算法。',**evidence(real,'diagonal-hybrid-v1','diagonal-hybrid-results')}
    # The CPU measurements remain byte-for-byte those of the three fresh processes.
    cpu=next(s for s in old['stories'] if s['id']=='cpu-repeat')
    return {'schema':'gugis-result-focus-v2','inputs':inputs,'stories':[paper,source,cpu],'secondary':old['secondary'],'previous_version':'shared/result-focus-v1.json'}

def body():return (json.dumps(derive(),ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');a=p.parse_args();b=body()
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Stronger focused manifest differs from exact evidence')
    else:
        if OUTPUT.exists():raise FileExistsError('Focused version cannot be overwritten')
        OUTPUT.write_bytes(b)
    print(f'Stronger focused results and complete source bindings verified: {len(b)} bytes')

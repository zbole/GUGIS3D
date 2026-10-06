"""Promote equally fitted real-DTM controls, keeping all prior focus versions immutable."""
import argparse,json
from build_result_focus_v4 import ROOT,sha,derive as previous_focus
OUTPUT=ROOT/'shared/result-focus-v5.json'
def derive():
    r=previous_focus();raw=(ROOT/'shared/source-global-fit-display-v1.json').read_bytes();s=json.loads(raw);base=ROOT/'frontend/public/research/source-global-fit-v1';report=(base/'results.json').read_bytes();p=s['package'];zipraw=(base/p['filename']).read_bytes()
    if sha(report)!=s['report_sha256'] or sha(zipraw)!=p['sha256'] or len(zipraw)!=p['bytes']:raise ValueError('Shared-fit report or complete package changed')
    for path,body in [('shared/source-global-fit-display-v1.json',raw),('frontend/public/research/source-global-fit-v1/results.json',report),('frontend/public/research/source-global-fit-v1/'+p['filename'],zipraw)]:r['inputs'].append({'path':path,'sha256':sha(body)})
    rows=[(c,next(p for p in c['byte_pairs'] if p['byte_ceiling']==8192)) for c in s['cases']];a=s['aggregates']['hybrid_vs_fitted_p1'];f=s['aggregates']['fitting'];other=s['aggregates']['hybrid_vs_fitted_ruled']
    r['stories'][1]={'id':'real-hybrid','category':'真实地形 / 同等共享拟合','headline':'同等优化条件，混合仍有优势','value':a['fixed_budget_wins'],'unit':'/20','value_note':'真实样区的 E₂ 低于同等拟合 P1','context':'20 个原始源 DTM 窗口 · 完整文件上限 8,192 B','baseline':'两种对角线的 P1 三角带，同样优化全部共享角点高程；计入全部分组成本','coverage':f'全部十档预算 {a["all_budget_wins"]}/200 更低；相对同等拟合纯面带，固定上限 {other["fixed_budget_wins"]}/20 更低。','controls':f'{a["fixed_budget_losses"]}/20 组三角带更低，混合最差高 {-a["minimum_reduction_percent"]:.4f}%；最好降低 {a["maximum_reduction_percent"]:.4f}%。{f["e2_strict_improvements"]:,}/{f["model_count"]:,} 个模型拟合后 E₂ 下降、文件不增，但 {f["maximum_increases"]} 个最大差增加；不是独立地面精度或最优拓扑。','points':[{'id':c['id'],'name':c['name'],'reduction_percent':100*(1-c['models'][p['hybrid-fit']]['e2_m2']/c['models'][p['p1-fit']]['e2_m2'])} for c,p in rows],'report_sha256':s['report_sha256'],'detail_href':'#source-fit-results','package_url':'/research/source-global-fit-v1/'+s['package']['filename'],'package_bytes':s['package']['bytes'],'package_sha256':s['package']['sha256']}
    r.update(schema='gugis-result-focus-v5',previous_version='shared/result-focus-v4.json');return r
def body():return (json.dumps(derive(),ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');a=p.parse_args();b=body()
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Shared-fit focus differs from immutable measured sources')
    else:
        if OUTPUT.exists():raise FileExistsError('Published focus version cannot be overwritten')
        OUTPUT.write_bytes(b)
    print('Shared-fit focus verified: '+str(len(b))+' bytes')

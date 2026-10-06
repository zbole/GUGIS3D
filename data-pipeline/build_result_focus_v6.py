"""Promote an explicit error threshold and actual-file decision, keep v5 immutable."""
import argparse,json
from build_result_focus_v5 import ROOT,sha,derive as previous_focus
OUTPUT=ROOT/'shared/result-focus-v6.json'

def derive():
    r=previous_focus();raw=(ROOT/'shared/paper-finite-frontier-v1.json').read_bytes();s=json.loads(raw);base=ROOT/'frontend/public/research/paper-finite-frontier-v1';report=(base/'results.json').read_bytes();package=s['package'];z=(base/package['filename']).read_bytes()
    if sha(report)!=s['report_sha256'] or sha(z)!=package['sha256'] or len(z)!=package['bytes']:raise ValueError('Immutable finite archive changed')
    for path,b in [('shared/paper-finite-frontier-v1.json',raw),('frontend/public/research/paper-finite-frontier-v1/results.json',report),('frontend/public/research/paper-finite-frontier-v1/'+package['filename'],z)]:r['inputs'].append({'path':path,'sha256':sha(b)})
    c=next(c for c in s['cases'] if c['id']==s['defaults']['default_case']);row=next(x for x in c['error_rows'] if x['target_e2_m2']==s['defaults']['default_e2_target_m2']);f,a=[c['models'][row['selected'][k]] for k in ['fitted','adaptive_pt']];counts=s['summary']['anisotropic-quartic'];other=s['summary']['published-quartic']
    labels={'fixed_pt':'旧固定 Pₜ','adaptive_pt':'完整自适应 Pₜ','before':'原方向面带','fitted':'GUGIS 共享拟合','p2':'P₂ 高阶控制'}
    r['stories'][0]={'id':'paper-file-frontier','category':'论文对照 / 同一误差门槛','headline':'达到同一误差门槛，文件更小','value':100*(1-f['binary_bytes']/a['binary_bytes']),'unit':'%','value_note':'比本次完整自适应 Pₜ 的达标文件小','context':'强各向异性四次曲面 · 30° · 全域 E₂ ≤ 0.1 m²','baseline':'论文 Pₜ 区域贪心 / 插值 L₁ 选边；双方各在原九档实际保存文件内选择','coverage':f"强各向异性全七方向：同误差门槛 {counts['error_rows']['wins']}/69 个成对结果文件更小；另 22 组缺少成对候选，不计获益。",'controls':f"P₂ 达标文件仅 {c['models'][row['selected']['p2']]['binary_bytes']:,} B，仍更小。较均衡曲面同空间上限仅 {other['byte_rows']['wins']}/63 个成对结果误差更低，含 {other['byte_rows']['losses']} 组失利。Pₜ 独立 XYZ 编码并非最小平面系数编码；这是已观察数据的有限档案分析。",'metrics':[{'label':label,'value':c['models'][row['selected'][key]]['binary_bytes'],'unit':'B','tone':'gugis' if key=='fitted' else 'control' if key=='p2' else 'baseline'} for key,label in labels.items()],'metric_caption':'达标完整文件 / B · P₂ 控制仍更小；Iₜ 原九档没有达标文件','report_sha256':s['report_sha256'],'detail_href':'#paper-frontier-results','package_url':'/research/paper-finite-frontier-v1/'+package['filename'],'package_bytes':package['bytes'],'package_sha256':package['sha256']}
    r.update(schema='gugis-result-focus-v6',previous_version='shared/result-focus-v5.json');return r
def body():return (json.dumps(derive(),ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');a=p.parse_args();b=body()
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Finite-file focus differs from immutable sources')
    else:
        if OUTPUT.exists():raise FileExistsError('Published focus version cannot be overwritten')
        OUTPUT.write_bytes(b)
    print(f'Finite-file focus verified: {len(b)} bytes')

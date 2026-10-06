"""Promote the stricter uniform-codec result; preserve every prior focus version."""
import argparse,json
from pathlib import Path
from build_result_focus_v6 import ROOT,sha,derive as previous_focus
OUTPUT=ROOT/'shared/result-focus-v7.json'
def derive():
    report=previous_focus();raw=(ROOT/'shared/paper-coordinate-sharing-v1.json').read_bytes();source=json.loads(raw)
    base=ROOT/'frontend/public/research/paper-coordinate-sharing-v1';full=(base/'results.json').read_bytes();package=source['package'];archive=(base/package['filename']).read_bytes()
    if sha(full)!=source['report_sha256'] or len(archive)!=package['bytes'] or sha(archive)!=package['sha256']:raise ValueError('Uniform-codec evidence changed')
    for path,blob in [('shared/paper-coordinate-sharing-v1.json',raw),('frontend/public/research/paper-coordinate-sharing-v1/results.json',full),('frontend/public/research/paper-coordinate-sharing-v1/'+package['filename'],archive)]:report['inputs'].append({'path':path,'sha256':sha(blob)})
    case=next(c for c in source['cases'] if c['id']==source['defaults']['default_case']);row=next(r for r in case['error_rows'] if r['target_e2_m2']==source['defaults']['default_e2_target_m2'])
    fitted,adaptive=[case['models'][row['selected'][m]] for m in ('fitted','adaptive_pt')];strong=source['summary']['anisotropic-quartic'];balanced=source['summary']['published-quartic'];p2=case['models'][row['selected']['p2']]
    labels={'fixed_pt':'固定网格 Pₜ','adaptive_pt':'完整自适应 Pₜ','before':'原方向面带','fitted':'GUGIS 共享拟合','p2':'P₂ 高阶控制'}
    report['stories'][0]={'id':'paper-file-frontier','category':'论文对照 / 统一无损编码','headline':'双方共享坐标后，达标文件仍更小','value':100*(1-fitted['binary_bytes']/adaptive['binary_bytes']),'unit':'%','value_note':'比统一编码的自适应 Pₜ 达标文件小','context':'强各向异性四次曲面 · 30° · 全域 E₂ ≤ 0.1 m²','baseline':'六方法统一无损 XY 字典；计入全部头部、坐标引用、高程与原拓扑，按各自原九档实际文件选择','coverage':f"强各向异性七方向同误差门槛：{strong['error_rows']['wins']}/69 个成对结果文件更小；22 组缺少成对候选，不计获益。",'controls':f"P₂ 达标文件 {p2['binary_bytes']:,} B，仍更小。较均衡曲面同空间上限 {balanced['byte_rows']['wins']}/63 获益、{balanced['byte_rows']['losses']} 组失利。748 个文件全部逐字节恢复；252 个变小、496 个变大均保留。不是最小平面系数编码或渐近证明。",'metrics':[{'label':label,'value':case['models'][row['selected'][key]]['binary_bytes'],'unit':'B','tone':'gugis' if key=='fitted' else 'control' if key=='p2' else 'baseline'} for key,label in labels.items()],'metric_caption':'统一无损编码后的达标完整文件 / B · P₂ 更小，Iₜ 原九档未达标','report_sha256':source['report_sha256'],'detail_href':'#paper-coordinate-results','package_url':'/research/paper-coordinate-sharing-v1/'+package['filename'],'package_bytes':package['bytes'],'package_sha256':package['sha256']}
    report.update(schema='gugis-result-focus-v7',previous_version='shared/result-focus-v6.json');return report
def body():return (json.dumps(derive(),ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode()
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');a=p.parse_args();blob=body()
    if a.check:
        if OUTPUT.read_bytes()!=blob:raise ValueError('Current focus differs from immutable uniform-codec source')
    else:
        with OUTPUT.open('xb') as handle:handle.write(blob)
    print(f'Uniform-codec result focus verified: {len(blob)} bytes')

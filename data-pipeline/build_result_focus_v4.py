"""Promote all sixty real-source CPU observations without altering prior versions."""
import argparse,json
from build_result_focus_v3 import ROOT,sha,derive as prior_focus
OUTPUT=ROOT/'shared/result-focus-v4.json'
def derive():
    r=prior_focus();raw=(ROOT/'shared/source-query-display-v1.json').read_bytes();s=json.loads(raw);base=ROOT/'frontend/public/research/source-query-v1'
    if raw!=(base/'publication.json').read_bytes() or sha((base/'results.json').read_bytes())!=s['report_sha256']:raise ValueError('Immutable source CPU results changed')
    package=s['package'];zb=(base/package['filename']).read_bytes()
    if len(zb)!=package['bytes'] or sha(zb)!=package['sha256']:raise ValueError('Complete source CPU evidence changed')
    for path,b in [('shared/source-query-display-v1.json',raw),('frontend/public/research/source-query-v1/results.json',(base/'results.json').read_bytes()),('frontend/public/research/source-query-v1/'+package['filename'],zb)]:r['inputs'].append({'path':path,'sha256':sha(b)})
    a=s['aggregate']['p2_over_compact'];g=s['aggregate']['grid_over_compact'];old=s['aggregate']['generic_over_compact']
    r['stories'][2]={'id':'real-source-query','category':'真实地形 CPU 查询','headline':'保存的面带，直接算出地形','value':a['minimum'],'unit':'×','value_note':'相对当前精确 P₂ 查询实现的最低实测比值','context':'20 个真实 1 m DTM 窗口 · 三次新 Node 进程','baseline':'同一双线性源函数的精确 P₂ 原生查询 · 相同点定位、高度与解析梯度','coverage':f'{a["wins"]}/{a["total"]} 组更快；全部范围 {a["minimum"]:.3f}–{a["maximum"]:.3f}×；保留 5,760 条计时记录。','points':[{'id':c['id'],'name':c['name'],'minimum':c['ranges']['p2_over_compact']['minimum'],'maximum':c['ranges']['p2_over_compact']['maximum']} for c in s['cases']],'controls':f'旧面带 / 新路径为 {old["minimum"]:.2f}–{old["maximum"]:.2f}×。规则栅格仍更快（栅格 / 面带 {g["minimum"]:.3f}–{g["maximum"]:.3f}）；实测范围不是置信区间；同设备、当前实现、固定窗口，非 GPU 或 ArcGIS 软件性能。','report_sha256':s['report_sha256'],'detail_href':'#source-query-results','package_url':'/research/source-query-v1/'+package['filename'],'package_bytes':package['bytes'],'package_sha256':package['sha256']}
    r.update(schema='gugis-result-focus-v4',previous_version='shared/result-focus-v3.json');return r
def body():return (json.dumps(derive(),ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');a=p.parse_args();b=body()
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Real-source CPU focus changed')
    else:
        if OUTPUT.exists():raise FileExistsError('Published focus cannot be overwritten')
        OUTPUT.write_bytes(b)
    print(f'Real-source CPU focus and all evidence bindings verified: {len(b)} bytes')

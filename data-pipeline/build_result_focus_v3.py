"""Promote the independently audited full PT-priority greedy result; keep v1/v2 intact."""
import argparse,json
from build_result_focus_v2 import ROOT,sha,derive as prior_focus
OUTPUT=ROOT/'shared/result-focus-v3.json'
def derive():
    r=prior_focus();raw=(ROOT/'shared/paper-adaptive-projection-ui-v1.json').read_bytes();s=json.loads(raw);full=(ROOT/'shared/paper-adaptive-projection-display-v1.json').read_bytes();base=ROOT/'frontend/public/research/paper-adaptive-projection-v1'
    if sha(full)!=s['source_summary_sha256'] or full!=(base/'publication.json').read_bytes() or sha((base/'results.json').read_bytes())!=s['report_sha256']:raise ValueError('Immutable adaptive results changed')
    package=s['package'];zb=(base/package['filename']).read_bytes()
    if len(zb)!=package['bytes'] or sha(zb)!=package['sha256']:raise ValueError('Complete adaptive evidence changed')
    for path,b in [('shared/paper-adaptive-projection-ui-v1.json',raw),('shared/paper-adaptive-projection-display-v1.json',full),('frontend/public/research/paper-adaptive-projection-v1/results.json',(base/'results.json').read_bytes()),('frontend/public/research/paper-adaptive-projection-v1/'+package['filename'],zb)]:r['inputs'].append({'path':path,'sha256':sha(b)})
    site=next(c for c in s['cases'] if c['id']=='anisotropic-quartic-30');pair=next(p for p in site['pairs'] if p['budget']==2048);entries={k:site['models'][pair[k]] for k in ['p1','pt','adaptive','before','fitted','p2']};a=entries['adaptive'];b=entries['fitted'];drop=lambda x,y:100*(1-x/y)
    def results(field):return [drop(c['models'][p['fitted']]['e2_m2'],c['models'][p['adaptive']]['e2_m2']) for c in s['cases'] if c['field']['id']==field for p in c['pairs']]
    strong=results('anisotropic-quartic');other=results('published-quartic');card=r['stories'][0]
    card.update(category='论文 Pₜ 完整区域贪心',headline='完整自适应对照，保留优势',value=drop(b['e2_m2'],a['e2_m2']),value_note='相对新 Pₜ 自适应贪心的全域 E₂ 降低',baseline='Pₜ 的 L₂ 区域优先级 + 公式 (2.18) 插值 L₁ 选边 · 重新生成完整自适应网格',coverage=f'{sum(v>0 for v in strong)}/{len(strong)} 组低于新 Pₜ；默认同空间拟合降低 {drop(b["e2_m2"],entries["before"]["e2_m2"]):.2f}%，{b["binary_bytes"]:,} B 不变。',
      controls=f'另一四次曲面仅 {sum(v>0 for v in other)}/{len(other)} 组获益；强各向异性 30°/N=64 仍不利。P₂ 更准确；这是有限预算本机复现，非作者原软件或渐近优越性证明。',
      metrics=[{'label':label,'value':entries[key]['e2_m2'],'unit':'m2 E₂','tone':tone} for key,label,tone in [('p1','原 P1','reference'),('pt','固定 Pₜ','reference'),('adaptive','自适应 Pₜ','reference'),('before','原面带','reference'),('fitted','拟合面带','gugis'),('p2','P₂ 控制','control')]],
      report_sha256=s['report_sha256'],detail_href='#paper-adaptive-results',package_url='/research/paper-adaptive-projection-v1/'+package['filename'],package_bytes=package['bytes'],package_sha256=package['sha256'])
    r.update(schema='gugis-result-focus-v3',previous_version='shared/result-focus-v2.json');return r
def body():return (json.dumps(derive(),ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');a=p.parse_args();b=body()
    if a.check:
        if OUTPUT.read_bytes()!=b:raise ValueError('Adaptive-focused manifest changed')
    else:
        if OUTPUT.exists():raise FileExistsError('Published focus version cannot be overwritten')
        OUTPUT.write_bytes(b)
    print(f'Full adaptive-paper focus and all source bindings verified: {len(b)} bytes')

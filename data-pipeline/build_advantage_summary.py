"""Derive a small results-first page manifest from immutable verified reports."""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'shared/validated-advantages-v1.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def derive():
    inputs=[]
    def load(name,folder):
        path='shared/'+name;raw=(ROOT/path).read_bytes();r=json.loads(raw);inputs.append({'path':path,'sha256':sha(raw)})
        path='frontend/public/research/'+folder+'/results.json';raw=(ROOT/path).read_bytes()
        if sha(raw)!=r['report_sha256']:raise ValueError('Report identity differs: '+name)
        inputs.append({'path':path,'sha256':sha(raw)})
        package=r['package'];b=(ROOT/'frontend/public/research'/folder/package['filename']).read_bytes()
        if len(b)!=package['bytes'] or sha(b)!=package['sha256']:raise ValueError('Evidence package changed')
        return r
    p=load('principal-ruled-display-v1.json','principal-ruled-v1');s=load('source-native-bands-v1.json','source-native-bands-v1');m=load('source-multipatch-v1.json','source-multipatch-v1');q=load('native-query-performance-v1.json','native-query-v1')
    reductions=[100*(1-c['pairs'][-1]['principal']['e2_m2']/c['pairs'][-1]['p1']['e2_m2']) for c in p['cases']]
    case=next(c for c in p['cases'] if c['angle_degrees']==30);pair=next(a for a in case['pairs'] if a['budget']==2048);a,b=pair['p1'],pair['principal']
    if not all(c['pairs'][-1]['budget']==2048 for c in p['cases']):raise ValueError('Paper headline budget differs')
    def receipt(report,folder):return {'report_sha256':report['report_sha256'],'package_url':'/research/'+folder+'/'+report['package']['filename'],'package_sha256':report['package']['sha256'],'package_bytes':report['package']['bytes']}
    source=s['cases'][0];sr=next(v for v in source['models'] if v['family']=='ruled');sp=next(v for v in source['models'] if v['family']=='source_p2')
    if not all(next(v for v in c['models'] if v['family']=='ruled')['e2_m2']<1e-8 and next(v for v in c['models'] if v['family']=='source_p2')['e2_m2']<1e-8 for c in s['cases']):raise ValueError('Same-function checks incomplete')
    mp=m['cases'][0]
    if not all(c['readback']['same_8192_source_faces'] and c['readback']['all_faces_upward'] for c in m['cases']):raise ValueError('Same geometry verification incomplete')
    ratios=[]
    for c in q['cases']:
        r,t=c['methods'];ratio=t['prepared_ns_per_query']['median']/r['prepared_ns_per_query']['median']
        if r['family']!='ruled' or t['family']!='triangles' or abs(ratio-c['ruled_vs_prepared_triangle_median_ratio'])>1e-12:raise ValueError('CPU median ratio differs')
        if r['e2_m2']>=1e-8 or t['e2_m2']>=1e-8:raise ValueError('CPU source functions differ')
        ratios.append(ratio)
    qc=q['cases'][ratios.index(max(ratios))]
    return {'schema':'gugis-validated-advantages-v1','inputs':inputs,'claims':[
      {'id':'paper-direction','kind':'error-percent','value':100*(1-b['e2_m2']/a['e2_m2']),'label':'相对论文式 P1 的全域误差降低','baseline':'顶点 P1 插值 · 论文式 L₂ 贪心 / L₁ 选边','context':'100:1 严格凸二次曲面 · 30° · N=2,048','evidence':'七个方向在 N=2,048 下全部降低 '+f'{min(reductions):.2f}%–{max(reductions):.2f}%','metric_unit':'E₂ / m²','gugis_metric':b['e2_m2'],'baseline_metric':a['e2_m2'],'detail_href':'#principal-direction-results','scope':'方向与表达阶次收益；336 B 的精确 P2 控制也已公开。',**receipt(p,'principal-ruled-v1')},
      {'id':'source-function','kind':'file-percent','value':100*(1-sr['binary_bytes']/sp['binary_bytes']),'label':'保留同一源函数的矢量文件减少','baseline':'逐格共享 XYZ 的 P2 三角函数','context':'真实 1 m DTM · 十城二十固定样区','evidence':str(len(s['cases']))+'/'+str(len(s['cases']))+' 同函数全域积分核验通过','metric_unit':'完整文件 / B','gugis_metric':sr['binary_bytes'],'baseline_metric':sp['binary_bytes'],'detail_href':'#source-function-results','scope':'原始 Float32 源函数；规则栅格与 GeoTIFF 更小的控制同样公开。',**receipt(s,'source-native-bands-v1')},
      {'id':'multipatch-format','kind':'file-percent','value':100*(1-mp['native_p1_bytes']/mp['bytes']),'label':'ArcGIS 兼容同几何文件减少','baseline':'实际 MultiPatch SHP/SHX/DBF/PRJ/CPG','context':'20 个真实源样区 · 相同 P1 三角表面','evidence':f'{sum(c["triangles"] for c in m["cases"]):,}'+' 个源三角面独立读回一致','metric_unit':'完整文件 / B','gugis_metric':mp['native_p1_bytes'],'baseline_metric':mp['bytes'],'detail_href':'#source-format-results','scope':'省略可选 M 的真实五文件；这是格式比较，未运行 ArcGIS 软件。',**receipt(m,'source-multipatch-v1')},
      {'id':'native-query','kind':'cpu-ratio','value':max(ratios),'label':'同函数原生查询的 CPU 中位数比','baseline':'准备完成的高阶三角函数查询','context':qc['name']+' · '+q['environment']['cpu_model'].replace('Intel(R) Core(TM) ','')+' · Node '+q['environment']['node'],'evidence':f'{min(ratios):.2f}–{max(ratios):.2f}'+'×，全部五个固定结构样例','metric_unit':'CPU 查询中位数 / ns','gugis_metric':qc['methods'][0]['prepared_ns_per_query']['median'],'baseline_metric':qc['methods'][1]['prepared_ns_per_query']['median'],'detail_href':'#native-query-results','scope':str(q['protocol']['prepared_trials'])+' 轮交替同点试验；比值为两种方法的耗时中位数之比，非 GPU/ArcGIS 测速。',**receipt(q,'native-query-v1')}
    ]}
def body():return (json.dumps(derive(),ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode()
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args();b=body()
    if args.check:
        if not DEST.exists() or DEST.read_bytes()!=b:raise ValueError('Visible advantage manifest is stale')
        print('All four visible advantage claims match immutable reports and actual packages')
    else:
        if DEST.exists():raise FileExistsError('A published advantage manifest cannot be overwritten')
        DEST.write_bytes(b);print('Created four verified headline claims from actual source reports')

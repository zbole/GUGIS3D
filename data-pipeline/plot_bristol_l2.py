import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'frontend/public/research/bristol-global-l2'
raw=(OUT/'results.json').read_bytes();report=json.loads(raw)
plt.rcParams.update({'font.family':'DejaVu Sans','svg.fonttype':'none','axes.spines.top':False,'axes.spines.right':False})
families=['global_compact','local_triangles','local_compact']
names=['Global compact hybrid','Local triangles','Local compact hybrid']
colors=['#72869c','#bd7626','#087f79']
fig,axes=plt.subplots(1,2,figsize=(12,4.8),layout='constrained')
for ax,case in zip(axes,['bristol-harbour','bristol-brandon-hill']):
    for family,name,color in zip(families,names,colors):
        rows=[m for m in report['models'] if m['case_id']==case and m['family']==family]
        ax.loglog([m['bytes']/1000 for m in rows],[m['e2_m2'] for m in rows],'o-',color=color,label=name,markersize=5)
        for m in rows:
            offset=(4,7)
            if case=='bristol-harbour' and family in ('global_compact','local_triangles'):
                if m['target_m']==.5:offset=(-12,-18)
                if m['target_m']==.25:offset=(5,10)
            ax.annotate(f"{m['target_m']*100:g}cm",(m['bytes']/1000,m['e2_m2']),xytext=offset,textcoords='offset points',fontsize=8,color=color)
    ax.set(title=case.replace('bristol-','').replace('-',' ').title(),xlabel='Native uncompressed archive (kB)',ylabel='Whole-domain E2 (m²) / smaller is better')
    ax.grid(alpha=.18);ax.legend(fontsize=8)
fig.suptitle('Fixed EA 1m DTM crops / exact polynomial integration / labels = maximum-bound targets',fontsize=12)
files={}
for extension in ['png','svg']:
    name=f'error-cost.{extension}'
    fig.savefig(OUT/name,dpi=150,metadata={'Date':None} if extension=='svg' else {})
    if extension=='svg':(OUT/name).write_text('\n'.join(line.rstrip() for line in (OUT/name).read_text(encoding='utf-8').splitlines())+'\n',encoding='utf-8',newline='\n')
    files[name]=hashlib.sha256((OUT/name).read_bytes()).hexdigest()
plt.close(fig)
(OUT/'figures.json').write_text(json.dumps({'report_sha256':hashlib.sha256(raw).hexdigest(),'plot_script_sha256':hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'files':files},indent=2)+'\n',encoding='utf-8',newline='\n')
print('Exported Bristol full-domain error/cost figures')

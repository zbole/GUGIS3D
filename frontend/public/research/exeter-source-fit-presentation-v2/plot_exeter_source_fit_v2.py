"""Presentation-only view: keep original measurements and release unchanged."""
import hashlib,json
from pathlib import Path
import matplotlib;matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1];DEST=ROOT/'frontend/public/research/exeter-source-fit-presentation-v2'
raw=(ROOT/'frontend/public/research/exeter-source-fit-v1/results.json').read_bytes();digest=hashlib.sha256(raw).hexdigest()
if digest!='10f005ad21a9b7580a688c77d4abb247fd57675284ba514cc32df7b5806af960':raise ValueError('Original result changed')
if DEST.exists():raise FileExistsError('Immutable presentation already exists')
r=json.loads(raw);colors={'p1-fit':'#537fb0','ruled-fit':'#aaa66b','hybrid-fit':'#19896e'};labels={'p1-fit':'Two-diagonal P1','ruled-fit':'Pure ruled bands','hybrid-fit':'Hybrid'}
fig,axes=plt.subplots(2,2,figsize=(12,8));fig.subplots_adjust(left=.075,right=.98,top=.91,bottom=.20,hspace=.38,wspace=.25)
for j,c in enumerate(r['cases']):
    for level in [0,1]:
        ax=axes[level,j]
        for m,color in colors.items():
            es=[e for e in c['candidates'] if e['method']==m]
            for fitted in [False,True]:
                values=[(e['binary_bytes'],e['e2_m2'] if fitted else e['original']['e2_m2']) for e in es];shown=[(x,y) for x,y in values if level==1 or y>=1e-8]
                ax.scatter([x for x,y in shown],[max(y,1e-12) for x,y in shown],s=16 if not fitted else 20,facecolors=color if fitted else 'none',edgecolors=color,alpha=.85 if fitted else .35,label=labels[m]+(' shared fit' if fitted else ' unfitted'))
            e=next(row for row in c['byte_pairs'] if row['byte_ceiling']==8192)[m];ax.scatter(e['binary_bytes'],e['e2_m2'],s=60,marker='D',facecolors='none',edgecolors='#233e34',linewidths=1.2)
        ax.set(xscale='log',yscale='log',title=c['id']+(' / approximation detail' if level==0 else ' / complete range'),xlabel='Complete native file / bytes',ylabel='Whole-domain E2 / m2');ax.axvline(8192,color='#a5b6aa',linestyle='--',linewidth=.8);ax.grid(alpha=.15);ax.tick_params(labelsize=9)
fig.suptitle('New Exeter windows / 49 frozen grids / equal shared-C0 fitting',fontsize=13)
fig.legend(*axes[0,0].get_legend_handles_labels(),loc='lower center',bbox_to_anchor=(.5,.085),ncols=3,fontsize=8,frameon=False)
fig.text(.5,.060,'All 294 fitted + 294 unfitted candidates retained. Diamonds: actual 8192 B minima. Top row: E2 >= 1e-8 detail.',ha='center',fontsize=8)
fig.text(.5,.037,'Bottom row: complete range; exact zero identities drawn at 1e-12 for log display only. No values changed for decisions.',ha='center',fontsize=8)
DEST.mkdir(parents=True);fig.savefig(DEST/'exeter-source-fit-results.svg');fig.savefig(DEST/'exeter-source-fit-results.png',dpi=150);plt.close(fig)
script=Path(__file__).read_bytes().replace(b'\r\n',b'\n');(DEST/'plot_exeter_source_fit_v2.py').write_bytes(script)
index={'schema':'gugis-exeter-source-fit-presentation-v2','source_report_sha256':digest,'scope':'Presentation only, complete source outcomes retained. Upper zoom excludes source identities only for readability; lower panels retain all models. No experiment or selection changes.','files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(DEST.iterdir()) if p.is_file()}}
(DEST/'index.json').write_text(json.dumps(index,indent=2)+'\n',encoding='utf8',newline='\n');print('Presentation v2 generated from unchanged original results')

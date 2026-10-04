"""Standalone scientific error/cost figures from frozen measured records."""
import hashlib
import json
import math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
FAMILIES={'hybrid':('Original hybrid','#97a4ac','s'),
          'compact_hybrid':('Compact hybrid','#2b846d','o'),
          'local_triangles':('Local triangles','#426e95','^'),
          'multipatch':('MultiPatch (5 files)','#b78d50','D')}


def main():
    report=json.loads((ROOT/'shared/terrain-error-cost.json').read_bytes())
    output=ROOT/'frontend/public/research/hybrid-terrain/tradeoff';output.mkdir(exist_ok=True)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'svg.fonttype':'none',
                        'svg.hashsalt':'gugis-terrain-tradeoff-v1'})
    images=[]
    for case in report['cases']:
        for metric,label in [('bound_m','Continuous-reference maximum error bound (cm)'),
                             ('rmse_m','RMSE at 4,096 identical query sites (cm)')]:
            fig,ax=plt.subplots(figsize=(10,5.5))
            fig.subplots_adjust(left=.095,right=.99,bottom=.17,top=.93)
            fig.patch.set_facecolor('#fbfdfc');ax.set_facecolor('#fbfdfc')
            front=set(case['frontiers'][metric]);has_floor=False;annotations=[]
            for family,(name,color,marker) in FAMILIES.items():
                points=sorted([r for r in case['records'] if r['family']==family],key=lambda r:r['target_m'])
                if not points:continue
                error=[max(r[metric]*100,1e-4) for r in points]
                has_floor|=any(r[metric]*100<1e-4 for r in points)
                ax.plot([r['bytes']/1000 for r in points],error,color=color,marker=marker,
                    linestyle='--',linewidth=.8,markersize=6,label=name,alpha=.85)
                for p,value in zip(points,error):
                    if p['id'] in front:
                        ax.scatter([p['bytes']/1000],[value],s=140,facecolors='none',edgecolors=color,linewidths=1.4,zorder=5)
                        same=next((a for a in annotations if a['bytes']==p['bytes'] and abs(a['error']-value)<=report['error_tie_tolerance_m']*100),None)
                        if same:same['targets'].add(p['target_m']*100)
                        else:annotations.append({'bytes':p['bytes'],'error':value,'targets':{p['target_m']*100},'color':color})
            for annotation in annotations:
                targets='/'.join(f'{n:g}' for n in sorted(annotation['targets']))
                ax.annotate(f"{targets} cm build{'s' if len(annotation['targets'])>1 else ''}",
                    (annotation['bytes']/1000,annotation['error']),xytext=(7,9),textcoords='offset points',fontsize=8,color=annotation['color'])
            ax.set_xscale('log');ax.set_yscale('log');ax.margins(.2)
            costs=[r['bytes']/1000 for r in case['records']]
            if math.log10(max(costs)/min(costs))<.3:
                centre=math.sqrt(min(costs)*max(costs))
                ax.set_xlim(centre/10**.2,centre*10**.2)
            ax.set_xlabel('Complete uncompressed representation (kB, 1 kB = 1,000 bytes)')
            ax.set_ylabel(label);ax.grid(which='major',color='#dce6e0',linewidth=.7)
            ax.grid(which='minor',color='#edf2ef',linewidth=.4)
            ax.set_title(case['id'].replace('-',' ').title()+' | '+('Raster reference' if case['reference_kind']=='bilinear-raster' else 'Authored function'),loc='left',weight='bold',pad=14)
            ax.legend(loc='best',frameon=True,facecolor='white',fontsize=9)
            note='Rings: observed nondominated records only. Lines connect four tested build targets; not an interpolated guarantee.'
            if metric=='rmse_m':note+=' RMSE is not a maximum-error bound.'
            if has_floor:note+=' Values below 0.0001 cm share the plotted floor.'
            fig.text(.01,.015,note,fontsize=7,color='#617469',wrap=True)
            for extension in ['png','svg']:
                path=output/f"{case['id']}-{metric}.{extension}"
                metadata={'Creator':'GUGIS3D measured terrain research'}
                if extension=='svg':metadata['Date']=None
                fig.savefig(path,dpi=150,metadata=metadata)
                if extension=='svg':
                    # Normalize before hashing: Git LF checkout must not alter receipts.
                    path.write_bytes(('\n'.join(line.rstrip() for line in path.read_text(encoding='utf-8').splitlines())+'\n').encode())
                content=path.read_bytes();images.append({'filename':path.name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
            plt.close(fig)
    (output/'figures.json').write_bytes((json.dumps({'schema':'gugis-error-cost-figures-v1',
        'parent_sha256':hashlib.sha256((ROOT/'shared/terrain-error-cost.json').read_bytes()).hexdigest(),
        'plotter_source_sha256':hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),
        'images':images},indent=2)+'\n').encode())
    print(f'{len(images)} standalone PNG/SVG figures saved')


if __name__=='__main__':main()

"""Export a scientific figure from measured Cesium CPU geometry buffers."""
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'shared/research-display-reuse.json'
OUT = ROOT / 'frontend/public/research/hybrid-terrain/display-reuse'


def main():
    report = json.loads(SOURCE.read_bytes())
    rows = {r['family']: r for r in report['records'] if r['case_id'] == 'swiss-dem-crop' and r['target_m'] == .1}
    families = ['hybrid', 'compact_hybrid', 'local_triangles']
    assert set(rows) == set(families)
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'svg.fonttype': 'none',
                         'svg.hashsalt': 'gugis-display-reuse-2026-10-05'})
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 6.875), dpi=120)
    fig.subplots_adjust(left=.065, right=.98, bottom=.29, top=.76, wspace=.25)
    fig.suptitle('Shared display vertices: identical triangles, smaller input buffers', x=.5, y=.95, fontsize=15)
    fig.text(.5, .895, 'Swiss DEM crop | 10 cm build target | Three representations | Exact-coordinate sharing', ha='center', fontsize=11, color='#49606a')
    labels=['Certified hybrid', 'Compact hybrid', 'Local triangles']; x=np.arange(3); width=.32
    for mode, dx, hatch in [('expanded', -.18, None), ('shared', .18, '//')]:
        bottom=np.zeros(3)
        for field, color, label in [('position_bytes', '#287887', 'Positions (Float64)'),
                                     ('normal_bytes', '#88afb8', 'Normals (Float32)'),
                                     ('index_bytes', '#ccdbe0', 'Indices (Uint32)')]:
            values=np.array([rows[f][mode][field]/1e6 for f in families])
            axes[0].bar(x+dx, values, width, bottom=bottom, color=color, hatch=hatch,
                        edgecolor='#5b7480', linewidth=.5, label=label if mode=='expanded' else None)
            bottom+=values
        for xpos,value in zip(x+dx,bottom):axes[0].text(xpos,value+.07,f'{value:.3f}',ha='center',fontsize=9)
        times=np.array([rows[f][mode]['prepare_ms'] for f in families])
        axes[1].bar(x+dx,times,width,color='#78929d' if mode=='expanded' else '#287887',label='Independent' if mode=='expanded' else 'Shared')
        for xpos,value in zip(x+dx,times):axes[1].text(xpos,value+.6,f'{value:.2f}',ha='center',fontsize=9)
    axes[0].set_ylabel('Measured attribute + index buffers (MB)')
    axes[0].set_title('A  Buffer bytes: 74.7% less in each representation',loc='left',fontsize=11)
    axes[0].set_ylim(0,4.7)
    axes[1].set_ylabel('CPU geometry preparation median (ms)')
    axes[1].set_title('B  CPU cost: sharing can add preparation time',loc='left',fontsize=11)
    axes[1].set_ylim(0,max(rows[f][m]['prepare_ms'] for f in families for m in ['expanded','shared'])*1.25)
    for ax in axes:
        ax.set_xticks(x,labels);ax.set_axisbelow(True);ax.grid(axis='y',color='#e1e8eb',linewidth=.7)
        ax.spines[['top','right']].set_visible(False);ax.tick_params(axis='x',length=0,labelsize=9)
    axes[0].legend(loc='upper center',bbox_to_anchor=(.5,-.15),ncol=1,frameon=False,fontsize=9)
    axes[1].legend(loc='upper center',bbox_to_anchor=(.5,-.15),ncol=2,frameon=False,fontsize=9)
    fig.text(.065,.11,'Left: unhatched = independent; hatched = shared. Triangle indices and oriented face geometry are unchanged.',fontsize=9)
    fig.text(.065,.075,'Right: 3 alternating trials after warm-up; garbage collection and face-hash audit excluded from timing.',fontsize=9)
    fig.text(.065,.04,'CPU TypedArray bytes only: excludes wire overlay, other Cesium buffers, peak/retained heap and GPU memory. No ArcGIS run.',fontsize=9,color='#49606a')
    OUT.mkdir(parents=True,exist_ok=True)
    png=OUT/'swiss-10cm-display-reuse.png';svg=OUT/'swiss-10cm-display-reuse.svg'
    fig.savefig(png,metadata={'Software':'GUGIS scientific display-buffer audit'})
    fig.savefig(svg,metadata={'Date':None});plt.close(fig)
    svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text('utf-8').splitlines())+'\n').encode('utf-8'))
    fingerprints={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [png,svg]}
    receipt={'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
             'plotter_sha256':hashlib.sha256(Path(__file__).read_text('utf-8').replace('\r\n','\n').encode()).hexdigest(),
             'figure_files':fingerprints}
    (OUT/'figures.json').write_bytes((json.dumps(receipt,indent=2)+'\n').encode())
    print(json.dumps(receipt,indent=2))


if __name__ == '__main__':
    main()

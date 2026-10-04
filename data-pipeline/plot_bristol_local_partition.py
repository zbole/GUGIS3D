"""Show actual native XY patches and both positive/negative cost outcomes."""
import argparse
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from build_bristol_terrain_benchmark import ROOT,digest,Terrain


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args();path=ROOT/'shared/bristol-local-partition.json';report=json.loads(path.read_bytes())
    public=ROOT/'frontend/public/research/bristol-local-partition'
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':9,'svg.hashsalt':'bristol-local-partition-2026-10-05'})
    fig,axes=plt.subplots(2,3,figsize=(15,9))
    for row,case in enumerate(report['cases']):
        folder=args.input/case['id'];reference=json.loads((folder/'reference.json').read_bytes())
        source=axes[row,0].imshow(reference['height'],origin='lower',extent=[-32,32,-32,32],cmap='terrain')
        axes[row,0].set_title(['Bristol harbour','Brandon Hill slope'][row]+' | source 1 m DTM')
        fig.colorbar(source,ax=axes[row,0],label='ODN (m)',shrink=.75)
        receipt=case['variants'][0]['local_hybrid'];content=(folder/receipt['filename']).read_bytes()
        if digest(content)!=receipt['sha256']:raise ValueError('Actual topology model changed')
        model=Terrain.model_validate(json.loads(content));polygons=[];colours=[]
        for patch in model.patches:
            if patch.kind=='ruled-strip':
                a,b,c,d=patch.left[0],patch.right[0],patch.left[1],patch.right[1]
                polygons.append([model.points[i][:2] for i in (a,c,d,b)]);colours.append('#66ae99')
            else:
                for face in patch.faces():polygons.append([model.points[i][:2] for i in face]);colours.append('#c2cbd1')
        axes[row,1].add_collection(PolyCollection(polygons,facecolors=colours,edgecolors='#50665b',linewidths=.25))
        axes[row,1].set_xlim(-32,32);axes[row,1].set_ylim(-32,32);axes[row,1].set_aspect('equal')
        axes[row,1].set_title('10 cm local partition | green ruled / grey triangles')
        for col in (0,1):axes[row,col].set_xlabel('BNG easting offset (m)');axes[row,col].set_ylabel('BNG northing offset (m)')
        x=np.arange(3)
        for i,(field,label,colour) in enumerate([('global_compact_bytes','Global compact hybrid','#9fb9ae'),
                                                ('compact_local_hybrid','Local compact hybrid','#478c74'),
                                                ('local_triangles_bytes','Local triangles','#b87f55')]):
            values=[(v[field]['bytes'] if isinstance(v[field],dict) else v[field])/1000 for v in case['variants']]
            axes[row,2].bar(x+(i-1)*.24,values,width=.23,label=label,color=colour)
        axes[row,2].set_xticks(x,['10 cm','25 cm','50 cm']);axes[row,2].set_ylabel('Native JSON (decimal kB)')
        axes[row,2].set_title('Complete costs: advantages and remaining penalties')
        axes[row,2].grid(axis='y',alpha=.2);axes[row,2].set_axisbelow(True)
    handles,labels=axes[0,2].get_legend_handles_labels()
    fig.legend(handles,labels,loc='lower center',bbox_to_anchor=(.5,.105),ncol=3,frameon=False)
    fig.suptitle('Local refinement and conforming triangle-strip closure | real Bristol',fontsize=17,y=.97)
    fig.text(.06,.056,'Local partitions are smaller than global hybrid in all six cases; harbour beats local triangles, hill remains larger.',fontsize=10)
    fig.text(.06,.027,'C0 shared-edge closure; no C1 or optimality claim. Source-raster error, not ground accuracy. EA 2022 / OGL v3; no ArcGIS software run.',fontsize=9)
    fig.subplots_adjust(left=.065,right=.965,top=.90,bottom=.22,hspace=.38,wspace=.40)
    files=[public/'local-topology-cost.png',public/'local-topology-cost.svg']
    for file in files:
        fig.savefig(file,dpi=120,metadata={'Date':None} if file.suffix=='.svg' else {})
        if file.suffix=='.svg':file.write_text('\n'.join(s.rstrip() for s in file.read_text(encoding='utf-8').splitlines())+'\n',encoding='utf-8')
    plt.close(fig)
    manifest={'report_sha256':digest(path.read_bytes()),'plotter_sha256':digest(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),
              'figures':[{'filename':f.name,'bytes':f.stat().st_size,'sha256':digest(f.read_bytes())} for f in files]}
    (public/'figures.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()

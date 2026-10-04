"""Render actual saved certified raster models, not an idealized illustration."""
import argparse,json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection,LineCollection
ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True)
    root=parser.parse_args().input;report=json.loads((root/'results.json').read_bytes())
    output=ROOT/'frontend/public/research/hybrid-terrain'
    for case in report['cases']:
        for pair in case['variants']:
            for mode,label in [('hybrid','Certified reference hybrid'),('local_triangles','Local longest-edge triangles'),('compact_hybrid','Compact hybrid strips')]:
                receipt=pair[mode];model=json.loads((root/case['id']/receipt['filename']).read_bytes())
                points=np.asarray(model['points']);triangles=[];quads=[];lines=[]
                for patch in model['patches']:
                    if patch['kind']=='ruled-strip':
                        quads.extend(points[[a,c,d,b],:2] for a,b,c,d in zip(patch['left'],patch['right'],patch['left'][1:],patch['right'][1:]))
                        lines.extend(points[[a,b],:2] for a,b in zip(patch['left'],patch['right']))
                    else:
                        ids=patch['indices'];triangles.extend(points[ids[i:i+3],:2] for i in range(len(ids)-2))
                fig,ax=plt.subplots(figsize=(5.6,4.5),layout='constrained',facecolor='white')
                if triangles:ax.add_collection(PolyCollection(triangles,facecolors='#aabacb',edgecolors='#f9fbfc',linewidths=.13))
                if quads:ax.add_collection(PolyCollection(quads,facecolors='#63b7a7',edgecolors='#e6f3ef',linewidths=.13))
                if lines:ax.add_collection(LineCollection(lines,colors='#26826d',linewidths=.18))
                ax.set(xlim=(points[:,0].min(),points[:,0].max()),ylim=(points[:,1].min(),points[:,1].max()),xlabel='Local x (m)',ylabel='Local y (m)')
                ax.set_aspect('equal');ax.set_title(f'{label} | target {pair["target_m"]:g} m',fontsize=10)
                fig.savefig(output/f'{case["id"]}-{Path(receipt["filename"]).stem}.png',dpi=140);plt.close(fig)
        print(case['id'],flush=True)


if __name__=='__main__':main()

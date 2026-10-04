"""Own scientific figures from saved hybrid models and their source references."""
import argparse
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection, LineCollection
ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args();report=json.loads((args.input/'results.json').read_bytes())
    output=ROOT/'frontend/public/research/hybrid-terrain'
    for data in report['cases']:
        directory=args.input/data['id'];reference=np.load(directory/'reference.npz')
        x,y,z=reference['x'],reference['y'],reference['height'];xx,yy=np.meshgrid(x,y)
        fig=plt.figure(figsize=(7.5,4.5),layout='constrained',facecolor='#f8fbfa')
        ax=fig.add_subplot(111,projection='3d');ax.set_facecolor('#f8fbfa')
        step=max(1,len(x)//48)
        ax.plot_surface(xx[::step,::step],yy[::step,::step],z[::step,::step],cmap='viridis',linewidth=.1,
            antialiased=True,alpha=.94)
        ax.set(xlabel='Local x (m)',ylabel='Local y (m)',zlabel='Height (m)')
        ax.view_init(elev=30,azim=-128);ax.set_title('Source reference surface',fontsize=12)
        fig.savefig(output/f'{data["id"]}-reference.png',dpi=140);plt.close(fig)
        for variant in data['variants']:
            for mode in ('hybrid','triangles'):
                terrain=json.loads((directory/variant[mode]['filename']).read_bytes());points=np.asarray(terrain['points'])
                polygons=[];colors=[];lines=[]
                for patch in terrain['patches']:
                    if patch['kind']=='ruled-strip':
                        a,b,c,d=points[[patch['left'][0],patch['right'][0],patch['left'][1],patch['right'][1]]]
                        polygons.append([a[:2],c[:2],d[:2],b[:2]]);colors.append('#63b7a7')
                        lines.append([(a[:2]+c[:2])/2,(b[:2]+d[:2])/2])
                    else:
                        indices=patch['indices']
                        for i in range(len(indices)-2):
                            polygons.append(points[indices[i:i+3],:2]);colors.append('#aabacb')
                fig,ax=plt.subplots(figsize=(5.6,4.5),layout='constrained',facecolor='white')
                ax.add_collection(PolyCollection(polygons,facecolors=colors,edgecolors='#f9fbfc',linewidths=.25))
                if lines:ax.add_collection(LineCollection(lines,colors='#216f61',linewidths=.75))
                ax.set(xlim=(x[0],x[-1]),ylim=(y[0],y[-1]),xlabel='Local x (m)',ylabel='Local y (m)')
                ax.set_aspect('equal');ax.set_title(f'{mode.capitalize()} | target {variant["target_m"]:g} m',fontsize=12)
                fig.savefig(output/f'{data["id"]}-{mode}-{variant["target_m"]:g}m.png',dpi=140);plt.close(fig)
        print(data['id'],flush=True)


if __name__=='__main__':main()

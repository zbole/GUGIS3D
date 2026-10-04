"""Actual saved local-triangle topology, with no idealized diagram geometry."""
import argparse
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args();report=json.loads((args.input/'results.json').read_bytes())
    output=ROOT/'frontend/public/research/hybrid-terrain'
    for case in report['cases']:
        for pair in case['variants']:
            model=pair['local_triangles'];terrain=json.loads((args.input/case['id']/model['filename']).read_bytes())
            points=np.asarray(terrain['points']);polygons=[]
            for patch in terrain['patches']:
                indices=patch['indices']
                polygons.extend(points[indices[i:i+3],:2] for i in range(len(indices)-2))
            if len(polygons)!=model['triangles']:raise ValueError('Stored strip faces differ from receipt')
            fig,ax=plt.subplots(figsize=(5.6,4.5),layout='constrained',facecolor='white')
            ax.add_collection(PolyCollection(polygons,facecolors='#aabacb',edgecolors='#f9fbfc',linewidths=.25))
            ax.set(xlim=(-100,100),ylim=(-100,100),xlabel='Local x (m)',ylabel='Local y (m)')
            ax.set_aspect('equal');ax.set_title(f'Local conforming triangles | target {pair["target_m"]:g} m',fontsize=11)
            fig.savefig(output/f'{case["id"]}-local-triangles-{pair["target_m"]:g}m.png',dpi=140);plt.close(fig)
        print(case['id'],flush=True)


if __name__=='__main__':main()

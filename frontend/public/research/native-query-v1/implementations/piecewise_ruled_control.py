"""Fixed C0 ruled-strip scale controls, with full P3 nodal triangles.

These purpose-built fields test representation structure, not the strictly
convex C2 theorem in arXiv:1101.1452 or a real DEM. Counts are fixed before
measurement; shared nodes are canonicalized in both encodings.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from terrain_order_control import ROOT, digest, polynomial_model, polynomial_metrics, write_model
from publish_terrain_order_control import curve_integral

COUNTS=(8,32,128)

def source(count,xy):
    xy=np.asarray(xy);x,y=xy[...,0],xy[...,1];width=100/count
    j=np.minimum(count-1,np.maximum(0,np.floor((x+50)/width).astype(int)))
    left=-50+j*width;amplitude=.2+.05*np.cos(2*np.pi*j/count)
    return 30+.001*x+.002*y+amplitude/width**2*(x-left)*(x-left-width)*(1+.002*y)

def models(count):
    if count not in COUNTS:raise ValueError('Only fixed, preregistered strip counts')
    points=[];pool={};patches=[];triangles=[];width=100/count
    def node(x,y,z):
        key=(x,y)
        if key in pool:
            if abs(points[pool[key]][2]-z)>1e-12:raise ValueError('Nonconforming boundary')
            return pool[key]
        pool[key]=len(points);points.append([x,y,z]);return pool[key]
    for j in range(count):
        left=-50+j*width;right=left+width;curves=[]
        for y in (-50.,50.):
            xx=np.array([left,(left+right)/2,right]);z=source(count,np.column_stack([xx,np.full(3,y)]))
            curves.append([node(left,y,float(z[0])),node(float(xx[1]),y,float(2*z[1]-(z[0]+z[2])/2)),node(right,y,float(z[2]))])
        patches.append({'kind':'quadratic-ruled','left':curves[0],'right':curves[1]})
        triangles.extend([np.array([[left,-50.],[right,-50.],[right,50.]]),np.array([[left,-50.],[right,50.],[left,50.]])])
    ruled={'format':'gugis-research-surface','version':2,'coordinate_system':'LOCAL_METERS','points':points,'patches':patches}
    triangle=polynomial_model(triangles,lambda xy:source(count,xy),3)
    if len(points)!=4*count+2 or len(triangle['points'])!=12*count+4:raise ValueError('Shared node counts changed')
    return ruled,triangle

def build(folder):
    if folder.exists():raise FileExistsError('Fresh private directory required')
    folder.mkdir(parents=True)
    scripts=['data-pipeline/piecewise_ruled_control.py','data-pipeline/terrain_order_control.py','data-pipeline/publish_terrain_order_control.py','data-pipeline/curved_ruled_benchmark.py']
    report={'schema':'gugis-piecewise-ruled-control-v1','counts':list(COUNTS),'domain_m':[-50,-50,50,50],
      'scripts':{p:digest((ROOT/p).read_text(encoding='utf8').replace('\r\n','\n').encode()) for p in scripts},
      'source_definition':'For j=floor((x+50)/w), w=100/n, L=-50+j*w: f=30+.001*x+.002*y+(.2+.05*cos(2*pi*j/n))/w^2*(x-L)*(x-L-w)*(1+.002*y). j is clamped at the outer boundary.',
      'scope':'Fixed purpose-built C0 piecewise P2xP1 fields. Gradient has one-sided limits at internal strip boundaries. Both models preserve exactly the same piecewise polynomial. Not real DEM, C2 paper theorem, optimal global encoding or measured RAM.',
      'structure_fixtures':[]}
    for count in COUNTS:
        ruled,triangle=models(count);cid=f'piecewise-{count}';out=folder/cid;out.mkdir();fn=lambda xy:source(count,xy)
        am=curve_integral(ruled,fn);am.update(controls=len(ruled['points']),patches=count,rms_m=am['e2_m2']/100)
        a=write_model(out,'ruled',ruled,am);b=write_model(out,'p3-triangles',triangle,polynomial_metrics(triangle,fn,nodes=11))
        if max(a['e2_m2'],b['e2_m2'])>=1e-8:raise ValueError('Same-function precision gate failed')
        c={'id':cid,'name':f'{count} 条连续直纹面带','strips':count,'triangle_degree':3,'ruled':a,'triangles':b,
           'both_numerically_exact':True,'numerical_e2_tolerance_m2':1e-8,'scope':report['scope'],
           'json_saving_percent':100*(1-a['bytes']/b['bytes']),'binary_saving_percent':100*(1-a['binary_bytes']/b['binary_bytes'])}
        report['structure_fixtures'].append(c)
        print(json.dumps({'id':cid,'ruled_bytes':a['binary_bytes'],'p3_bytes':b['binary_bytes'],'saving_percent':c['binary_saving_percent']},ensure_ascii=False),flush=True)
    (folder/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8',newline='\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);build(p.parse_args().output)

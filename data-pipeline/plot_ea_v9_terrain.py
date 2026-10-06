"""Plot real EA source and unsuppressed native-preview residuals for new city samples."""
import argparse,hashlib,json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.enums import Resampling
from acquire_ea_city_dtm import ROOT
def sha(b):return hashlib.sha256(b).hexdigest()
def plot(city_id):
    if city_id != 'exeter':raise ValueError('Unreviewed plot source')
    info=next(s for s in json.loads((ROOT/'shared/public-terrain-sources-v9.json').read_bytes())['sources'] if s['city_id']==city_id)
    out=ROOT/f'frontend/public/research/{city_id}-terrain';audit_bytes=(out/'preview-audit.json').read_bytes();audit=json.loads(audit_bytes)
    assert sha(audit_bytes)==info['sample_audit_sha256']
    csv=np.genfromtxt(out/'pixel-queries.csv',delimiter=',',names=True)
    raster_path=ROOT/f'backend/data/terrain/{city_id}-ea-dtm-1m.tif'
    assert sha(raster_path.read_bytes())==info['raster_sha256']
    with rasterio.open(raster_path) as ds:
        grid=ds.read(1,out_shape=(ds.height//4,ds.width//4),masked=True,resampling=Resampling.nearest)
        box=ds.bounds;east=ds.transform.c+(csv['column']+.5)*ds.transform.a;north=ds.transform.f+(csv['row']+.5)*ds.transform.e
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'svg.fonttype':'none','svg.hashsalt':'gugis-ea-multicity-2026-10-06'})
    fig,axes=plt.subplots(1,2,figsize=(12.5,6.875),dpi=120);fig.subplots_adjust(left=.06,right=.93,bottom=.30,top=.79,wspace=.38)
    fig.suptitle(f'{city_id.title()} real bare-earth DTM: coverage and preview residuals',y=.95,fontsize=14)
    fig.text(.5,.90,'EA 2022 composite | 1 m source | EPSG:27700 | ODN heights | Partial sample',ha='center',color='#48675b')
    im=axes[0].imshow(grid,extent=[box.left,box.right,box.bottom,box.top],origin='upper',cmap='terrain',vmin=info['min_height_m'],vmax=info['max_height_m'])
    axes[0].set_title('A  Source (map display every 4 pixels)',loc='left',fontsize=10);fig.colorbar(im,ax=axes[0],fraction=.046,pad=.025,label='Height (m ODN)')
    valid=np.isfinite(csv['difference_m']);limit=2.;residual=csv['difference_m'][valid]
    im=axes[1].scatter(east[valid],north[valid],c=residual,cmap='RdBu_r',vmin=-limit,vmax=limit,s=7,linewidths=0)
    axes[1].set_title('B  20-pixel preview - original source pixels',loc='left',fontsize=10);fig.colorbar(im,ax=axes[1],fraction=.046,pad=.025,label='Native preview - source (m)',extend='both')
    for ax in axes:
        ax.set_xlim(box.left,box.right);ax.set_ylim(box.bottom,box.top);ax.set_aspect('equal');ax.set_xlabel('BNG easting (m)');ax.set_ylabel('BNG northing (m)')
        ax.ticklabel_format(useOffset=False,style='plain');ax.tick_params(axis='x',labelrotation=25,labelsize=9)
    clipped=int((np.abs(residual)>limit).sum())
    fig.text(.06,.15,f"Hits {audit['hits']:,}/{audit['requested']:,}; RMSE {audit['rmse_m']:.3f} m; maximum absolute difference {audit['max_absolute_m']:.3f} m.",fontsize=10)
    fig.text(.06,.105,f'Residual colour +/-2 m; {clipped} outliers saturate. Fixed seed; 40-pixel rim excluded before querying.',fontsize=9)
    fig.text(.06,.065,'Source participates in fitting. Sampled raster differences, not a continuous or independent ground-accuracy guarantee.',fontsize=9)
    fig.text(.06,.025,'EA copyright/database right 2022; OGL v3.0. No ellipsoidal height conversion, formal city write or ArcGIS run.',fontsize=9,color='#48675b')
    png=out/f'{city_id}-source-preview.png';svg=out/f'{city_id}-source-preview.svg';fig.savefig(png);fig.savefig(svg,metadata={'Date':None});plt.close(fig)
    svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text('utf8').splitlines())+'\n').encode())
    (out/'figures.json').write_bytes((json.dumps({'raster_sha256':info['raster_sha256'],'audit_sha256':sha(audit_bytes),
        'plotter_sha256':sha(Path(__file__).read_bytes().replace(b'\r\n',b'\n')),
        'files':{p.name:{'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in (png,svg)}},indent=2)+'\n').encode())
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--city',required=True);plot(p.parse_args().city)

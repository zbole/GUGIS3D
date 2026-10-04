"""Scientific source map plus actual native-preview residuals, in source coordinates."""
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.enums import Resampling

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'frontend/public/research/bristol-terrain'


def main():
    info = json.loads((ROOT / 'shared/public-terrain-sources.json').read_bytes())['sources'][0]
    audit = json.loads((OUT / 'preview-audit.json').read_bytes())
    csv = np.genfromtxt(OUT / 'pixel-queries.csv', delimiter=',', names=True)
    path = ROOT / 'backend/data/terrain/bristol-ea-dtm-1m.tif'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == info['raster_sha256']
    with rasterio.open(path) as ds:
        # Plot decimation only; reported residuals remain the actual 4096 source centres.
        grid = ds.read(1, out_shape=(ds.height//4, ds.width//4), masked=True, resampling=Resampling.nearest)
        bounds = ds.bounds
        east = ds.transform.c + (csv['column']+.5)*ds.transform.a
        north = ds.transform.f + (csv['row']+.5)*ds.transform.e
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'svg.fonttype': 'none', 'svg.hashsalt': 'gugis-ea-dtm-2026-10-05'})
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 6.875), dpi=120)
    fig.subplots_adjust(left=.06, right=.93, bottom=.30, top=.79, wspace=.38)
    fig.suptitle('Bristol real bare-earth DTM: source coverage and preview differences', y=.95, fontsize=14)
    fig.text(.5, .90, 'Environment Agency 2022 composite | EPSG:27700 | ODN heights | Independent data candidate', ha='center', color='#48675b')
    im=axes[0].imshow(grid,extent=[bounds.left,bounds.right,bounds.bottom,bounds.top],origin='upper',cmap='terrain',vmin=-2,vmax=83)
    axes[0].set_title('A  Original 1 m source (map shown every 4 pixels)',loc='left',fontsize=10)
    fig.colorbar(im,ax=axes[0],fraction=.046,pad=.025,label='Source height (m ODN)')
    points=axes[1].scatter(east,north,c=csv['difference_m'],cmap='RdBu_r',vmin=-3,vmax=3,s=7,linewidths=0)
    axes[1].set_title('B  20-pixel preview minus source pixel height',loc='left',fontsize=10)
    fig.colorbar(points,ax=axes[1],fraction=.046,pad=.025,label='Native preview - source (m)',extend='both')
    for ax in axes:
        ax.set_xlim(bounds.left,bounds.right);ax.set_ylim(bounds.bottom,bounds.top)
        ax.set_aspect('equal');ax.set_xlabel('BNG easting (m)');ax.set_ylabel('BNG northing (m)')
        ax.ticklabel_format(useOffset=False,style='plain');ax.tick_params(axis='x',labelrotation=25,labelsize=9)
    clipped=int(np.count_nonzero(np.abs(csv['difference_m'])>3))
    fig.text(.06,.15,f"4,096 original-pixel samples: RMSE {audit['rmse_m']:.3f} m; maximum absolute difference {audit['max_absolute_m']:.3f} m.",fontsize=10)
    fig.text(.06,.105,f"Residual colour range +/-3 m; {clipped} outliers saturate. A 40-pixel rim is excluded from the sampled comparison.",fontsize=9)
    fig.text(.06,.065,'Source participates in preview construction. This is not held-out ground truth or a continuous error guarantee.',fontsize=9)
    fig.text(.06,.025,'EA copyright/database right 2022; Open Government Licence v3.0. Partial coverage, not all Bristol. No ArcGIS run.',fontsize=9,color='#48675b')
    png=OUT/'bristol-source-preview.png';svg=OUT/'bristol-source-preview.svg'
    fig.savefig(png);fig.savefig(svg,metadata={'Date':None});plt.close(fig)
    svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text('utf-8').splitlines())+'\n').encode())
    receipt={'raster_sha256':info['raster_sha256'],'audit_sha256':info['sample_audit_sha256'],
             'plotter_sha256':hashlib.sha256(Path(__file__).read_text('utf-8').replace('\r\n','\n').encode()).hexdigest(),
             'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [png,svg]}}
    (OUT/'figures.json').write_bytes((json.dumps(receipt,indent=2)+'\n').encode())
    print(json.dumps(receipt,indent=2))


if __name__ == '__main__':
    main()

"""Create fixed original-pixel queries; test the website's frozen native kernel."""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import shutil

import numpy as np
from pyproj import Transformer
import rasterio

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.local/benchmark/bristol-dtm-2026-10-05'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    model = json.loads((ROOT / 'backend/data/terrain/bristol-ea-dtm-preview.gugis-terrain.json').read_bytes())
    with rasterio.open(ROOT / 'backend/data/terrain/bristol-ea-dtm-1m.tif') as raster:
        # Exclude a 40-pixel rim, which lies outside/close to the preview's sample-centre boundary.
        rng = np.random.default_rng(20261005)
        sample = rng.choice((raster.height-80)*(raster.width-80), 4096, replace=False)
        rows = sample//(raster.width-80)+40
        cols = sample%(raster.width-80)+40
        sx, sy = rasterio.transform.xy(raster.transform, rows, cols, offset='center')
        to_geo = Transformer.from_crs(raster.crs, 4326, always_xy=True)
        lon, lat = to_geo.transform(sx, sy)
        to_ecef = Transformer.from_crs(4979, 4978, always_xy=True)
        ex, ey, ez = to_ecef.transform(lon, lat, np.zeros(4096))
        ox, oy, oz = to_ecef.transform(model['longitude'], model['latitude'], 0)
        a, b = math.radians(model['longitude']), math.radians(model['latitude'])
        x = -math.sin(a)*(ex-ox)+math.cos(a)*(ey-oy)
        y = -math.sin(b)*math.cos(a)*(ex-ox)-math.sin(b)*math.sin(a)*(ey-oy)+math.cos(b)*(ez-oz)
        values = raster.read(1)
        fixtures = [{'row': int(r), 'column': int(c), 'x': float(xx), 'y': float(yy),
                     'source_height_m': float(values[r,c])} for r,c,xx,yy in zip(rows,cols,x,y)]
    path = OUT / 'pixel-queries.json'
    path.write_bytes((json.dumps(fixtures, separators=(',', ':'))+'\n').encode())
    subprocess.run(['node', 'frontend/scripts/audit-bristol-terrain.mjs', str(path)], cwd=ROOT, check=True)
    report = json.loads((OUT / 'report.json').read_bytes())
    assert report['hits'] == report['requested'] == 4096 and report['misses'] == 0
    manifest_path = ROOT / 'shared/public-terrain-sources.json'
    manifest = json.loads(manifest_path.read_bytes())
    info = manifest['sources'][0]
    assert info['model_sha256'] == report['model_sha256'] and info['raster_sha256'] == report['raster_sha256']
    info['sample_audit'] = {key: report[key] for key in ['requested', 'hits', 'rmse_m', 'mae_m', 'p95_absolute_m', 'max_absolute_m']}
    info['sample_audit_sha256'] = hashlib.sha256((OUT / 'report.json').read_bytes()).hexdigest()
    manifest_path.write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode())
    (ROOT / 'shared/bristol-terrain-preview-audit.json').write_bytes((OUT / 'report.json').read_bytes())
    public = ROOT / 'frontend/public/research/bristol-terrain'
    public.mkdir(parents=True, exist_ok=True)
    for source, destination in [('report.json', 'preview-audit.json'), ('queries.csv', 'pixel-queries.csv'), ('pixel-queries.json', 'pixel-queries.json')]:
        shutil.copyfile(OUT / source, public / destination)


if __name__ == '__main__':
    main()

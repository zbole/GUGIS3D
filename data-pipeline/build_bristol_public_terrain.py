"""Prepare a pixel-preserving EA DTM download and a bounded, unsaved terrain preview."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.terrain_builder import import_dem
from app.services.workspace_catalog import CITY_DEFAULTS
from app.environment_models import Terrain

RAW_SHA256 = '6de1eca2b9865948bad1796fc6e68fa5b92e49a1e036706a06fec76162744d8d'
DATASET = 'https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-dtm-2022-1m'
NOTICE = '© Environment Agency copyright and/or database right 2022. All rights reserved.'
OUT = ROOT / 'backend/data/terrain'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    raw = args.source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != RAW_SHA256:
        raise ValueError('Source differs from the reviewed WCS acquisition; inspect a new source first')
    receipt = json.loads(args.source.with_suffix('.source.json').read_bytes())
    assert receipt['sha256'] == RAW_SHA256 and receipt['bytes'] == len(raw)
    OUT.mkdir(parents=True, exist_ok=True)
    raster_path = OUT / 'bristol-ea-dtm-1m.tif'
    if raster_path.exists():
        raise ValueError('Refusing to overwrite a published source raster')
    pixel_digest = hashlib.sha256()
    with rasterio.open(args.source) as src:
        assert src.count == 1 and src.crs.to_epsg() == 27700 and src.res == (1., 1.)
        assert src.width == 2384 and src.height == 2578 and src.dtypes == ('float32',)
        assert src.scales == (1.,) and src.offsets == (0.,)
        profile = {**src.profile, 'compress': 'deflate', 'predictor': 3, 'tiled': True,
                   'blockxsize': 256, 'blockysize': 256}
        valid, minimum, maximum = 0, float('inf'), -float('inf')
        with rasterio.open(raster_path, 'w', **profile) as dst:
            for top in range(0, src.height, 256):
                for left in range(0, src.width, 256):
                    window = Window(left, top, min(256, src.width-left), min(256, src.height-top))
                    block = src.read(1, window=window)
                    masked = src.read(1, window=window, masked=True)
                    finite = ~np.ma.getmaskarray(masked) & np.isfinite(block)
                    valid += int(finite.sum())
                    minimum = min(minimum, float(block[finite].min()))
                    maximum = max(maximum, float(block[finite].max()))
                    pixel_digest.update(block.astype('<f4').tobytes())
                    dst.write(block, 1, window=window)
        with rasterio.open(raster_path) as restored:
            assert restored.crs == src.crs and restored.transform == src.transform
            assert restored.nodata == src.nodata and restored.scales == src.scales and restored.offsets == src.offsets
            for top in range(0, src.height, 256):
                for left in range(0, src.width, 256):
                    window = Window(left, top, min(256, src.width-left), min(256, src.height-top))
                    assert np.array_equal(src.read(1, window=window), restored.read(1, window=window)), 'Raster pixels changed'
    raster = raster_path.read_bytes()
    bounds = CITY_DEFAULTS['bristol']['query_bbox_wgs84']
    terrain = import_dem(raster, 'Bristol · EA 2022 DTM · 20像元采样预览', datum='ODN', stride=20,
                         clip_bounds=bounds, coverage_label='布里斯托中心街区 · 独立公开地形样本')
    terrain.source.update({'来源': 'Environment Agency 2022 LIDAR Composite DTM；公开 WCS 中心街区裁剪',
                           '数据集说明': DATASET, '许可': 'Open Government Licence v3.0',
                           '署名': NOTICE, '原始下载SHA256': RAW_SHA256,
                           '下载时间UTC': receipt['retrieved_utc'],
                           '源高程基准依据': '官方数据集声明 metres / Ordnance Datum Newlyn；未作椭球高转换',
                           '源精度说明': '官方称构成复合数据的单项测量垂直精度 ±15 cm RMSE；不保证此采样模型达到15 cm',
                           '单位元数据冲突': 'WCS DescribeCoverage 错列 Elevation 单位为 W.m-2.Sr-1，GeoTIFF 未标高程单位；米制依据官方数据集正文，原描述保留',
                           '工作流': '仅公开下载与独立预览，正式城市未替换',
                           '方法边界': '采用现有城市导入的相邻坡度分类，不等同于有限尺度研究构建器或连续误差保证'})
    terrain = Terrain.model_validate(terrain.model_dump())
    model_path = OUT / 'bristol-ea-dtm-preview.gugis-terrain.json'
    model = (json.dumps(terrain.model_dump(exclude_none=True), ensure_ascii=False, separators=(',', ':'))+'\n').encode()
    model_path.write_bytes(model)
    for suffix in ['capabilities', 'description']:
        source = ROOT / f'.local/sources/ea-dtm-{suffix}-2026-10-05.xml'
        (OUT / f'ea-dtm-{suffix}.xml').write_bytes(source.read_bytes())
    info = {'city_id': 'bristol', 'name': '布里斯托 · 英国环境署裸地 DTM',
            'product': 'EA 2022 LIDAR Composite DTM · 1 m', 'dataset_url': DATASET,
            'license': 'Open Government Licence v3.0', 'attribution': NOTICE,
            'license_url': 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
            'source_url': receipt['url'], 'retrieved_utc': receipt['retrieved_utc'],
            'query_bbox_wgs84': bounds, 'raster_bbox_bng': receipt['bbox_bng'],
            'source_crs': 'EPSG:27700', 'vertical_datum': 'ODN', 'height_unit': 'm',
            'width': 2384, 'height': 2578, 'source_pixel_m': 1, 'valid_pixels': valid,
            'nodata_pixels': 2384*2578-valid, 'min_height_m': minimum, 'max_height_m': maximum,
            'raw_bytes': len(raw), 'raw_sha256': RAW_SHA256,
            'raster_bytes': len(raster), 'raster_sha256': hashlib.sha256(raster).hexdigest(),
            'raster_pixel_block_sha256': pixel_digest.hexdigest(),
            'compression_audit': 'DEFLATE only; every Float32 pixel, CRS, transform, NoData and scale/offset preserved',
            'preview_stride_pixels': 20, 'preview_points': len(terrain.points),
            'preview_patches': dict(Counter(p.kind for p in terrain.patches)),
            'model_bytes': len(model), 'model_sha256': hashlib.sha256(model).hexdigest(),
            'coverage_label': '布里斯托中心街区外接矩形，非全城；模型边界为采样像元中心',
            'accuracy_note': '1 m 源分辨率不等于20像元采样预览精度。保留ODN原高程；未保证全分辨率误差或工程精度。',
            'unit_metadata_warning': 'WCS Elevation 单位字段与官方米制说明冲突；GeoTIFF 未写高程单位，依据官方数据集正文采用米。'}
    (ROOT / 'shared/public-terrain-sources.json').write_bytes((json.dumps({'schema': 'gugis-public-terrain-sources-v1', 'sources': [info]}, ensure_ascii=False, indent=2)+'\n').encode())
    print(json.dumps(info, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()

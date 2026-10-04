"""Partition sampled height fields into ruled and triangular strips."""
import hashlib
import math
import numpy as np
from ..environment_models import Terrain, TerrainPatch


def from_grid(x, y, height, *, name, longitude, latitude, datum, demonstration, source):
    height = np.asarray(height, dtype=float)
    rows, cols = height.shape
    if rows < 2 or cols < 2 or rows*cols > 300000:
        raise ValueError('采样结果需为至少 2×2 且不超过 300,000 个点；请增大采样步长或裁剪 DEM')
    valid = np.isfinite(height) & np.isfinite(x) & np.isfinite(y)
    lookup = np.full(height.shape, -1, dtype=int)
    lookup[valid] = np.arange(np.count_nonzero(valid))
    points = [[round(float(a),5),round(float(b),5),round(float(z),5)]
              for a,b,z in zip(x[valid],y[valid],height[valid])]
    patches = []
    def append(kind, **kwargs):
        patches.append(TerrainPatch(id=f'p{len(patches)}', kind=kind, **kwargs))
    for r in range(0, rows-1, 2):
        for c in range(0, cols-1, 2):
            nr,nc = min(3,rows-r),min(3,cols-c)
            block = lookup[r:r+nr,c:c+nc]
            if np.any(block < 0):
                # NoData is a hole: do not interpolate across missing samples.
                for j in range(nr-1):
                    for i in range(nc-1):
                        corners = [int(block[j,i]),int(block[j,i+1]),int(block[j+1,i+1]),int(block[j+1,i])]
                        if min(corners) >= 0:
                            append('triangle-strip', indices=[corners[3],corners[0],corners[2],corners[1]])
                continue
            dx = np.hypot(np.diff(x[r:r+nr,c:c+nc],axis=1),np.diff(y[r:r+nr,c:c+nc],axis=1))
            dy = np.hypot(np.diff(x[r:r+nr,c:c+nc],axis=0),np.diff(y[r:r+nr,c:c+nc],axis=0))
            z = height[r:r+nr,c:c+nc]
            slope = max(float(np.max(np.abs(np.diff(z,axis=1))/np.maximum(dx,1e-9))),
                        float(np.max(np.abs(np.diff(z,axis=0))/np.maximum(dy,1e-9))))
            for j in range(nr-1):
                left,right = block[j].tolist(),block[j+1].tolist()
                if slope <= 0.15:
                    append('ruled-strip',left=left,right=right)
                else:
                    append('triangle-strip',indices=[v for pair in zip(right,left) for v in pair])
    if not patches:
        raise ValueError('裁剪范围没有可构面的有效 DEM 样本')
    return Terrain(name=name,longitude=longitude,latitude=latitude,vertical_datum=datum,
                   reference_height=round(float(np.median(height[valid])),5),
                   demonstration=demonstration,source=source,points=points,patches=patches)


def upgrade_legacy_fans(terrain: Terrain) -> Terrain:
    """Replace each planar fan with short strips without changing its triangles.

    A radial fan cannot generally be encoded as one nondegenerate strip. Splitting
    it into groups of at most three triangles preserves every face and NoData edge.
    This is a compatibility migration, not a claim that strips compress fans.
    """
    if not any(p.kind == 'triangle-fan' for p in terrain.patches):
        return terrain
    patches = []
    for patch in terrain.patches:
        if patch.kind != 'triangle-fan':
            patches.append(patch)
            continue
        ring = patch.ring
        for start in range(0, len(ring), 3):
            count = min(3, len(ring) - start)
            indices = [ring[start], ring[(start + 1) % len(ring)], patch.hub]
            indices.extend(ring[(start + offset) % len(ring)] for offset in range(2, count + 1))
            patches.append(TerrainPatch(id=f'{patch.id}_s{start // 3}', kind='triangle-strip', indices=indices))
    source = {**terrain.source, '转换记录': '旧三角扇按原三角面无损拆为三角带；保留旧档案兼容读取'}
    if '三类面带' in source.get('来源', ''):
        source['来源'] = source['来源'].replace('三类面带', '两类面带')
    if '三角扇' in source.get('分类规则', ''):
        source['原分类规则'] = source['分类规则']
        source['分类规则'] = '旧三角扇已按原三角面转换为三角带；后续新 DEM 仅生成直纹面带与三角带'
    return Terrain.model_validate({**terrain.model_dump(), 'source': source,
                                   'patches': [p.model_dump(exclude_none=True) for p in patches]})


def demo_terrain(*, center=None, name=None):
    axis=np.linspace(-650,650,53)
    x,y=np.meshgrid(axis,axis)
    z=12+45*np.exp(-((x+180)**2+(y-30)**2)/38000)+8*np.exp(-((x-100)**2+(y-350)**2)/20000)+0.008*y
    longitude,latitude = center or (-2.603,51.454)
    return from_grid(x,y,z,name=name or '布里斯托范围 · 方法演示地形（非实测）',longitude=longitude,latitude=latitude,
                     datum='local',demonstration=True,source={
                         '来源':'解析高程函数生成，仅演示直纹面带与三角带查询',
                         '精度':'不是布里斯托真实地形，不能用于地理测量或工程分析',
                         '采样间距':'25 m', '分类规则':'最大相邻坡度 ≤0.15 用直纹面带；较陡区域用三角带',
                         'DEM状态':'等待用户提供真实 DTM',
                     })


def _conservative_sample_mask(dataset, window, rows, cols):
    """Mark every reduced pixel whose source footprint intersects missing data.

    Native 256x256 reads bound scratch memory, including compressed GeoTIFFs.
    Integer overlap bounds also cover pixels straddling fractional reduced bins.
    """
    from rasterio.windows import Window
    height, width = int(window.height), int(window.width)
    missing = np.zeros((rows, cols), dtype=bool)
    source_missing = 0
    for top in range(0, height, 256):
        for left in range(0, width, 256):
            block = dataset.read(1, window=Window(window.col_off + left, window.row_off + top,
                                                 min(256, width-left), min(256, height-top)), masked=True)
            invalid = np.ma.getmaskarray(block) | ~np.isfinite(block.data)
            rr, cc = np.nonzero(invalid)
            source_missing += len(rr)
            if not len(rr):
                continue
            rr, cc = rr + top, cc + left
            r0, c0 = rr*rows//height, cc*cols//width
            r1 = ((rr+1)*rows + height-1)//height - 1
            c1 = ((cc+1)*cols + width-1)//width - 1
            for r, c in ((r0,c0), (r0,c1), (r1,c0), (r1,c1)):
                missing[r,c] = True
    return missing, source_missing


def import_dem(content, filename, source_crs='', datum='unknown', stride=10, *, clip_bounds=None, center=None, coverage_label=None):
    from rasterio.io import MemoryFile
    from rasterio.windows import from_bounds, Window
    from rasterio.transform import xy
    from rasterio.enums import Resampling
    from pyproj import CRS, Transformer
    if isinstance(stride, bool) or not isinstance(stride, int) or not 1 <= stride <= 100:
        raise ValueError('采样步长必须为 1 至 100 的整数')
    geographic_bounds = tuple(clip_bounds or (-2.614,51.446,-2.592,51.462))
    if (len(geographic_bounds) != 4 or not all(math.isfinite(v) for v in geographic_bounds)
        or not -180 <= geographic_bounds[0] < geographic_bounds[2] <= 180
        or not -85 <= geographic_bounds[1] < geographic_bounds[3] <= 85):
        raise ValueError('城市 DEM 裁剪范围必须为有效 WGS84 边界')
    lon0,lat0 = center or ((geographic_bounds[0]+geographic_bounds[2])/2,
                          (geographic_bounds[1]+geographic_bounds[3])/2)
    if not (math.isfinite(lon0) and math.isfinite(lat0) and -180 <= lon0 <= 180 and -85 <= lat0 <= 85):
        raise ValueError('城市地形基点必须为有效 WGS84 经度 / 纬度')
    # MemoryFile limits this importer to in-memory raster data, never VRT/remote references.
    driver = 'GTiff' if content[:4] in (b'II*\x00',b'MM\x00*',b'II+\x00',b'MM\x00+') else 'AAIGrid'
    if driver == 'AAIGrid' and not content.lstrip().lower().startswith(b'ncols'):
        raise ValueError('请提供 GeoTIFF (.tif) 或 ESRI ASCII Grid (.asc)，不支持压缩包和其他栅格格式')
    with MemoryFile(content, filename='dem.tif' if driver=='GTiff' else 'dem.asc') as mem:
        with mem.open(driver=driver) as dataset:
            if dataset.count != 1:
                raise ValueError('DEM 必须是单波段高程栅格')
            crs=CRS.from_user_input(source_crs) if source_crs else dataset.crs
            if crs is None:
                raise ValueError('DEM 未包含坐标系，请选择正确的源坐标系后重试')
            transform=dataset.transform
            if abs(transform.b)>1e-10 or abs(transform.d)>1e-10 or transform.a<=0 or transform.e>=0:
                raise ValueError('请先将 DEM 重投影为北向上的规则网格')
            to_source=Transformer.from_crs(4326,crs,always_xy=True)
            bounds=to_source.transform_bounds(*geographic_bounds,densify_pts=21)
            window=from_bounds(*bounds, transform=transform).round_offsets().round_lengths()
            try: window=window.intersection(Window(0,0,dataset.width,dataset.height))
            except Exception as error: raise ValueError('DEM 与当前城市工作区裁剪范围不相交') from error
            rows,cols=math.ceil(window.height/stride),math.ceil(window.width/stride)
            if rows*cols>300000:
                raise ValueError(f'裁剪后仍有 {rows*cols:,} 个采样点，请增大采样步长（当前 {stride}）')
            if rows<2 or cols<2: raise ValueError('裁剪后样本过少，请减小采样步长')
            source_pixels = int(window.height)*int(window.width)
            if source_pixels > 50000000:
                raise ValueError(f'裁剪范围含 {source_pixels:,} 个源像元，超过缺测检查预算 50,000,000；请先裁剪或拆成较小地形块')
            values=dataset.read(1,window=window,out_shape=(rows,cols),masked=True,resampling=Resampling.nearest).astype(float)
            scale,offset=dataset.scales[0],dataset.offsets[0]
            values=values*scale+offset
            z=values.filled(np.nan)
            if rows == int(window.height) and cols == int(window.width):
                missing = ~np.isfinite(z)
                source_missing = int(np.count_nonzero(missing))
            else:
                missing, source_missing = _conservative_sample_mask(dataset, window, rows, cols)
                z[missing] = np.nan
            omitted = int(np.count_nonzero(~np.isfinite(z)))
            z=z[::-1]
            if np.any(np.isfinite(z) & ((z < -500)|(z > 9000))):
                raise ValueError('高程超出 -500 至 9000 m，请确认输入高程单位为米且 NoData 正确')
            effective=dataset.window_transform(window)*dataset.transform.scale(window.width/cols,window.height/rows)
            rr,cc=np.meshgrid(np.arange(rows)[::-1],np.arange(cols),indexing='ij')
            sx,sy=xy(effective,rr,cc,offset='center')
            to_geo=Transformer.from_crs(crs,4326,always_xy=True)
            lon,lat=to_geo.transform(np.asarray(sx).reshape(rows,cols),np.asarray(sy).reshape(rows,cols))
            # Horizontal ENU coordinates from WGS84 at zero ellipsoid height.
            to_ecef=Transformer.from_crs(4979,4978,always_xy=True)
            ex,ey,ez=to_ecef.transform(lon,lat,np.zeros_like(lon))
            ox,oy,oz=to_ecef.transform(lon0,lat0,0)
            a,b=math.radians(lon0),math.radians(lat0)
            x=-math.sin(a)*(ex-ox)+math.cos(a)*(ey-oy)
            y=-math.sin(b)*math.cos(a)*(ex-ox)-math.sin(b)*math.sin(a)*(ey-oy)+math.cos(b)*(ez-oz)
            return from_grid(x,y,z,name=filename[:100],longitude=lon0,latitude=lat0,datum=datum,demonstration=False,source={
                '来源':'用户导入 DTM / DEM；未独立核验数据内容',
                '文件':filename[:200], 'SHA256':hashlib.sha256(content).hexdigest(),
                '源坐标系':str(crs), '源像元尺寸':f'{abs(transform.a):g} × {abs(transform.e):g}（源坐标系单位）',
                '采样':'nearest 重采样；步长 '+str(stride)+' 像元；'+str(cols)+' × '+str(rows),
                '分类规则':'最大相邻坡度 ≤0.15 用直纹面带；较陡区域用三角带',
                '覆盖范围':(coverage_label or '布里斯托起始街区及周边')+'；仅导入当前工作区裁剪范围，NoData 单元保留空洞',
                '裁剪边界WGS84':str(list(geographic_bounds)),
                '高程单位':'米；已应用栅格 scale / offset',
                '垂直处理':'保留源高程；显示时减去 reference_height，未转换为 WGS84 椭球高',
                '水平转换精度':f'PROJ 报告 {to_geo.accuracy:g} m（-1 表示未知；未保证测绘精度）',
                '误差说明':'采样与曲面插值可能改变像元间地形；尚未验证全分辨率误差界限',
                'NoData处理':'分块检查原始像元；采样像元覆盖缺测或非有限高程时剔除控制点，可能扩大缺测边缘；不跨缺测构面',
                '裁剪源像元':str(source_pixels), '无效源像元':str(source_missing), '剔除采样控制点':str(omitted),
            })

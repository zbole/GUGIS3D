"""One-time, versioned migration of the active city's legacy fan patches."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from app.routers.city import read_current, revision, write_snapshot  # noqa: E402
from app.services.city_archive import pack_city  # noqa: E402
from app.services.terrain_builder import upgrade_legacy_fans  # noqa: E402


def main():
    previous, city = read_current()
    environment = city.environment
    terrain = environment.terrain if environment else None
    if terrain is None:
        raise SystemExit('当前城市没有地形')
    fans = sum(p.kind == 'triangle-fan' for p in terrain.patches)
    if fans == 0:
        source = dict(terrain.source)
        if '转换记录' not in source or '三类面带' not in source.get('来源', ''):
            print('当前城市地形已经仅含直纹面带和三角带；无需转换')
            return
        source['来源'] = source['来源'].replace('三类面带', '两类面带')
        if '三角扇' in source.get('分类规则', ''):
            source['原分类规则'] = source['分类规则']
            source['分类规则'] = '旧三角扇已按原三角面转换为三角带；后续新 DEM 仅生成直纹面带与三角带'
        upgraded = terrain.model_copy(update={'source': source})
    else:
        upgraded = upgrade_legacy_fans(terrain)
    updated = city.model_copy(update={'environment': environment.model_copy(update={'terrain': upgraded})})
    content, stats = pack_city(updated)
    receipt = write_snapshot(updated, content, stats, revision(previous))
    print(f'转换 {fans} 个旧三角扇为 {len(upgraded.patches)-len(terrain.patches)+fans} 个三角带；'
          f'旧版 {revision(previous)[:16]}… 与新版 {receipt["revision"][:16]}… 均已保存至版本快照')


if __name__ == '__main__':
    main()

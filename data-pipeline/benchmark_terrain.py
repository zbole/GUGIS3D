"""Publish a reproducible terrain-only GUGIS vs MultiPatch file benchmark."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from app.environment_models import Terrain  # noqa: E402
from app.services.terrain_multipatch import export_multipatch  # noqa: E402


def main():
    city_path = ROOT / '.local/city/current.gugis.json'
    data = city_path.read_bytes()
    city = json.loads(data)
    raw = (city.get('environment') or {}).get('terrain')
    if raw is None:
        raise SystemExit('当前城市没有地形，无法建立 MultiPatch 基准')
    if any(p['kind'] == 'triangle-fan' for p in raw['patches']):
        raise SystemExit('当前城市仍有旧三角扇；请先在网站点击“转换旧三角扇”并保存')
    terrain = Terrain.model_validate(raw)
    revision = hashlib.sha256(data).hexdigest()
    output = ROOT / '.local/benchmark' / f'terrain-{revision[:16]}.zip'
    report = export_multipatch(terrain, output, city_revision=revision)
    report['packageSha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
    report_path = ROOT / 'shared/terrain-multipatch-benchmark.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'package': str(output), 'report': str(report_path),
                      'savingPercent': report['storageSavingPercent'],
                      'maxHeightErrorMetres': report['maxRuledHeightErrorMetres']},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()

"""Build four real resolution exports, same-query audits and an ArcGIS harness."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.environment_models import Terrain  # noqa: E402
from app.services.terrain_comparison import export_comparison_suite  # noqa: E402


def main():
    city_path = ROOT / '.local/city/current.gugis.json'
    content = city_path.read_bytes()
    city = json.loads(content)
    terrain = Terrain.model_validate(city['environment']['terrain'])
    if any(p.kind == 'triangle-fan' for p in terrain.patches):
        raise SystemExit('请先转换并保存旧三角扇，再建立当前两类面带实验')
    node = shutil.which('node')
    if node is None:
        raise SystemExit('Node.js is required to run the same native query kernel as the website')
    fixture = json.loads(subprocess.check_output([node, str(ROOT / 'frontend/scripts/terrain-comparison-fixture.mjs'),
        str(city_path)], cwd=ROOT, text=True, encoding='utf-8'))
    revision = hashlib.sha256(content).hexdigest()
    if fixture['cityRevision'] != revision or city_path.read_bytes() != content:
        raise SystemExit('City changed during fixture generation; rerun on a stable saved revision')
    directory = ROOT / '.local/benchmark'
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / f'terrain-suite-{uuid.uuid4().hex}.zip.tmp'
    try:
        report = export_comparison_suite(terrain, fixture, temporary,
                                         arcgis_script=ROOT / 'data-pipeline/run_arcgis_pro.py')
        destination = directory / f'terrain-suite-{revision[:16]}-{report["bundleId"]}.zip'
        os.replace(temporary, destination)
        alias = directory / f'terrain-suite-{revision[:16]}.zip'
        alias_temp = alias.with_suffix(f'.{uuid.uuid4().hex}.tmp')
        try:
            shutil.copyfile(destination, alias_temp)
            os.replace(alias_temp, alias)
        finally:
            alias_temp.unlink(missing_ok=True)
    finally:
        temporary.unlink(missing_ok=True)
    path = ROOT / 'shared/terrain-comparison-suite.json'
    report_temp = path.with_suffix(f'.{uuid.uuid4().hex}.tmp')
    try:
        report_temp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        os.replace(report_temp, path)
    finally:
        report_temp.unlink(missing_ok=True)
    overview = {k: report[k] for k in ('schema', 'bundleId', 'cityRevision', 'demonstration', 'verticalDatum',
                                      'packageBytes', 'packageSha256', 'derivativeMethod', 'statistics')}
    overview['reportSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    overview['variants'] = [{k: v[k] for k in ('ruledSubdivisions', 'gugisTerrainBytes', 'multipatchFilesBytes',
        'maxRuledHeightErrorMetres', 'storageSavingPercent', 'queries')} for v in report['variants']]
    overview_path = ROOT / 'shared/terrain-comparison-overview.json'
    overview_temp = overview_path.with_suffix(f'.{uuid.uuid4().hex}.tmp')
    try:
        overview_temp.write_text(json.dumps(overview, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        os.replace(overview_temp, overview_path)
    finally:
        overview_temp.unlink(missing_ok=True)
    print(json.dumps({'report': str(path), 'package': str(destination),
        'variants': [{k: v[k] for k in ('ruledSubdivisions', 'multipatchFilesBytes', 'maxRuledHeightErrorMetres', 'queries')}
                      for v in report['variants']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()

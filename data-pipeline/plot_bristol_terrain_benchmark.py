"""Source DTM maps and complete cost results, without cropping negative cases."""
import argparse
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from build_bristol_terrain_benchmark import ROOT, digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    args = parser.parse_args()
    source = ROOT / 'shared/bristol-certified-terrain.json'
    report = json.loads(source.read_bytes())
    public = ROOT / 'frontend/public/research/bristol-certified'
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'svg.hashsalt': 'bristol-certified-2026-10-05'})
    fig, axes = plt.subplots(2, 2, figsize=(12.5, 9))
    colours = {'hybrid': '#548c82', 'compact_hybrid': '#9ab6ad', 'local_triangles': '#b0714d'}
    names = {'hybrid': 'Original hybrid', 'compact_hybrid': 'Compact hybrid', 'local_triangles': 'Local triangles'}
    for col, case in enumerate(report['cases']):
        reference_bytes = (args.input / case['id'] / 'reference.json').read_bytes()
        if digest(reference_bytes) != case['reference_sha256']:
            raise ValueError('Source crop changed')
        reference = json.loads(reference_bytes)
        image = axes[0, col].imshow(reference['height'], origin='lower', extent=[-32, 32, -32, 32], cmap='terrain')
        axes[0, col].set_title(['Bristol harbour', 'Brandon Hill slope'][col]+' | original 1 m DTM')
        axes[0, col].set_xlabel('Easting offset (m)'); axes[0, col].set_ylabel('Northing offset (m)')
        fig.colorbar(image, ax=axes[0, col], label='Height ODN (m)', shrink=.85)
        x = np.arange(len(case['variants']))
        for i, family in enumerate(names):
            axes[1, col].bar(x+(i-1)*.24, [p[family]['bytes']/1000 for p in case['variants']],
                             width=.23, color=colours[family], label=names[family])
        axes[1, col].set_xticks(x, [f"{p['target_m']*100:g} cm" for p in case['variants']])
        axes[1, col].set_xlabel('Maximum continuous reference-error target')
        axes[1, col].set_ylabel('Native JSON (decimal kB)')
        axes[1, col].set_title('All three targets and representations')
        axes[1, col].grid(axis='y', alpha=.2); axes[1, col].set_axisbelow(True)
    handles, labels = axes[1, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc='lower center', bbox_to_anchor=(.5, .115), ncol=3, frameon=False)
    fig.suptitle('Real Bristol terrain | matched-error storage experiment', fontsize=17, y=.97)
    fig.text(.06, .065, 'Two fixed 64 x 64 m source crops; no NoData. Bound is relative to interpolated source raster, not unknown ground.', fontsize=9)
    fig.text(.06, .037, 'Local triangles are smaller in all six cases. Source EA 2022 / OGL v3. No ArcGIS application or GPU performance measured.', fontsize=9)
    fig.subplots_adjust(left=.08, right=.94, top=.90, bottom=.23, hspace=.56, wspace=.36)
    paths = [public / 'source-and-cost.png', public / 'source-and-cost.svg']
    for path in paths:
        fig.savefig(path, dpi=130, metadata={'Date': None} if path.suffix == '.svg' else {})
        if path.suffix == '.svg':
            path.write_text('\n'.join(line.rstrip() for line in path.read_text(encoding='utf-8').splitlines())+'\n', encoding='utf-8')
    plt.close(fig)
    manifest = {'report_sha256': digest(source.read_bytes()),
                'plotter_sha256': digest(Path(__file__).read_bytes().replace(b'\r\n', b'\n')),
                'figures': [{'filename': p.name, 'bytes': p.stat().st_size, 'sha256': digest(p.read_bytes())} for p in paths]}
    (public / 'figures.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()

"""Publish auditable scalar results and own scientific plots, never author weights.

Use isolated numpy/scipy/scikit-image/matplotlib environment. --prepare produces
the fixture for frontend/scripts/research-terrain-queries.mjs before final output.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.metrics import structural_similarity
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]


def metrics(reference, prediction, height_range):
    error = np.asarray(prediction, dtype=float) - reference
    absolute = np.abs(error)
    normalized = error * 2 / height_range
    smooth_ref = gaussian_filter(reference, sigma=4)
    smooth_pred = gaussian_filter(prediction, sigma=4)
    ref_grad = np.stack(np.gradient(smooth_ref), axis=-1)[4:-4, 4:-4]
    pred_grad = np.stack(np.gradient(smooth_pred), axis=-1)[4:-4, 4:-4]
    ref_norm, pred_norm = np.linalg.norm(ref_grad, axis=-1), np.linalg.norm(pred_grad, axis=-1)
    mask = (ref_norm > .01) & (pred_norm > .01)
    cosine = (ref_grad * pred_grad).sum(axis=-1)[mask] / (ref_norm[mask]*pred_norm[mask])
    angles = np.rad2deg(np.arccos(np.clip(cosine, -1, 1)))
    return {'rmse_m': float(np.sqrt(np.mean(error**2))), 'mae_m': float(absolute.mean()),
        'p95_absolute_m': float(np.percentile(absolute, 95)), 'max_absolute_m': float(absolute.max()),
        'bias_m': float(error.mean()), 'psnr_peak_1_db': float(-10*np.log10(np.mean(normalized**2))),
        'ssim': float(structural_similarity(reference/height_range, prediction/height_range, data_range=1.,
                     gaussian_weights=True, sigma=1.5, use_sample_covariance=False)),
        'smoothed_gradient_norm_rmse': float(np.sqrt(np.mean((ref_norm-pred_norm)**2))),
        'smoothed_gradient_direction_mean_degrees': float(angles.mean()) if len(angles) else None,
        'gradient_direction_valid_samples': int(mask.sum())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    replay = json.loads((args.input / 'replay.json').read_bytes())
    arrays = np.load(args.input / 'replay.npz')
    rng = np.random.default_rng(20261005)
    probes = rng.integers(0, 1000, (512, 2))
    if args.prepare:
        (args.input / 'query-fixture.json').write_text(json.dumps({'query': arrays['query'].tolist(), 'probes': probes.tolist()}), encoding='utf-8')
        return
    low, high = replay['height_range_m']
    reference = (arrays['reference'].astype(float)+1)*.5*(high-low)+low
    spg = (arrays['spg'].astype(float)+1)*.5*(high-low)+low
    sidecar = {key: replay[key] for key in ['reference_repo_revision', 'source_sha256', 'crs', 'height_range_m',
        'residual_range_normalized', 'reference_shape', 'reference_pixel_centres', 'preprocessing', 'reconstruction']}
    sidecar_bytes = len((json.dumps(sidecar, separators=(',', ':'))+'\n').encode('utf-8'))
    native = json.loads((args.input / 'native.json').read_bytes())
    multipatches = {f'gugis-{row["stride_m"]}m': row for row in json.loads((args.input/'multipatch.json').read_bytes())}
    queries = json.loads((args.input / 'native-queries.json').read_bytes())
    query_records = {record['id']: record for record in queries['reports']}
    variants, predictions = [], {'spg': spg}
    for row in native:
        predicted = np.load(args.input / f"{row['id']}.npy")
        query = query_records[row['id']]
        expected = predicted[probes[:, 0], probes[:, 1]]
        probe_error = np.abs(expected-np.asarray(query['probe_values']))
        if np.max(probe_error) > 1e-6:
            raise ValueError(f"Independent native kernel disagrees with readback reconstruction: {row['id']} {probe_error.max()}")
        timing = {key: query[key] for key in ['index_ms', 'query_count', 'query_repetitions_ms']}
        multipatch = multipatches[row['id']]
        multipatch_grid = np.load(args.input / f"multipatch-{row['stride_m']}m.npy")
        variants.append({**row, **timing, 'metrics': metrics(reference, predicted, high-low),
                         'kernel_readback_max_difference_m': float(probe_error.max()), 'kernel_probe_count': len(probes),
                         'multipatch': {**multipatch, 'metrics': metrics(reference, multipatch_grid, high-low),
                             'native_discretization_rmse_m': float(np.sqrt(np.mean((multipatch_grid-predicted)**2))),
                             'native_discretization_max_m': float(np.abs(multipatch_grid-predicted).max()),
                             'native_file_saving_percent': (1-row['bytes']/multipatch['bytes'])*100}})
        predictions[row['id']] = predicted
    report = {'schema': 'gugis-implicit-terrain-benchmark-v1', 'generated_at': '2026-10-04',
        'dataset': {'name': 'ImplicitTerrain author demo · Swiss 2494_1141', **sidecar,
                    'source_bytes': replay['source_bytes'], 'source_shape': replay['source_shape'],
                    'evaluated_samples': int(reference.size), 'raw_float32_reference_bytes': reference.size*4,
                    'scope': 'Independent Swiss research sample; not terrain for any UK city'},
        'method': {'metric_scope': 'All 1,000,000 pixel centres, reconstructed heights in metres; no held-out split',
            'psnr': '−10 log10(MSE in [-1,1] normalized heights), peak=1; follows author notebook',
            'ssim': 'skimage Gaussian sigma=1.5, window=11, population covariance, data_range=1 after division by source height range; explicit local variant, not claimed identical to paper defaults',
            'derivatives': 'Both reconstructions and reference Gaussian sigma=4 px; 1 m central differences; exclude 4 px border; direction requires both gradient norms >0.01. Grid-based analysis, not analytic-derivative or paper Table 2 replication.',
            'storage': 'Uncompressed validated native JSON including all metadata vs both actual .pth files + minimal required recovery/CRS sidecar; source GeoTIFF and reference array listed separately',
            'timing': 'Warm 4096 identical continuous coordinates, seed 20261004, five repetitions. PyTorch CPU batch versus Node native scalar query; runtime/implementation differ, no software-speed winner inferred.',
            'native_accuracy': 'Actual backend builder, two strip kinds, 0.15 slope switch, terminal boundary retained, rounded 5-decimal coordinates; reloaded archives independently checked at 512 points using the website native kernel',
            'multipatch': 'Same saved control net; native triangle strips unchanged, ruled cells tessellated once using triangle strips; five actual components in EPSG:2056, read back and rasterized over all reference pixels. No ArcGIS software executed.'},
        'runtime': {'python': replay['python'], 'torch': replay['torch'], 'node': queries['runtime'], 'platform': replay['platform'], 'device': 'CPU', 'torch_threads': replay['threads']},
        'spg': {'weights': replay['weights'], 'sidecar_bytes': sidecar_bytes,
                'bytes': sum(w['bytes'] for w in replay['weights'])+sidecar_bytes,
                'metrics': metrics(reference, spg, high-low), 'dense_inference_ms': replay['dense_inference_ms'],
                'query_count': replay['query_count'], 'query_repetitions_ms': replay['query_repetitions_ms'],
                'training_ms': None, 'status': 'local-pretrained-cpu-replay'},
        'variants': variants,
        'pending': ['ArcGIS Pro execution, GPU memory and frame rate', 'SPG retraining cost and repeat-seed training stability', 'Critical network precision/recall/F0.5 and MIG distance with an audited common topology pipeline', 'Independent-source/held-out reference accuracy'],
        'sources': {'project': 'https://fengyee.github.io/implicit-terrain/', 'paper': 'https://fengyee.github.io/implicit-terrain/static/pdfs/ImplicitTerrain_camera_ready.pdf', 'repository': 'https://github.com/Fengyee/implicit-terrain'},
        'paper_context': {'venue': 'CVPR 2024 Workshop INRV', 'model_mb': 1.51, 'raster_mb': 7.6,
                          'status': 'author-reported only; different dataset/file accounting from this local demo replay'}}
    figures = ROOT / 'frontend/public/research/implicit-terrain'
    figures.mkdir(parents=True, exist_ok=True)
    # Shared height/error scales make panels comparable; own plots, no scraped figures.
    for name, prediction in predictions.items():
        fig, ax = plt.subplots(figsize=(5, 5), dpi=140)
        image = ax.imshow(prediction-reference, cmap='RdBu_r', vmin=-2, vmax=2, extent=[0,1000,0,1000])
        ax.set(xlabel='East (m)', ylabel='North (m)', title=f'{name} | height error (m)')
        fig.colorbar(image, ax=ax, label='Error (m); clipped at ±2 m')
        fig.tight_layout(); fig.savefig(figures / f'{name}-error.png'); plt.close(fig)
    fig, ax = plt.subplots(figsize=(5, 5), dpi=140)
    image = ax.imshow(reference, cmap='terrain', extent=[0,1000,0,1000])
    ax.set(xlabel='East (m)', ylabel='North (m)', title='Swiss author sample | reference DTM')
    fig.colorbar(image, ax=ax, label='Elevation (m)'); fig.tight_layout(); fig.savefig(figures/'reference.png'); plt.close(fig)
    target = ROOT / 'shared/implicit-terrain-benchmark.json'
    content = (json.dumps(report, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
    target.write_bytes(content)
    (figures / 'results.json').write_bytes(content)
    import csv
    with (figures/'results.csv').open('w', newline='', encoding='utf-8-sig') as handle:
        writer=csv.writer(handle)
        writer.writerow(['method','stride_m','bytes','rmse_m','mae_m','p95_absolute_m','max_absolute_m','psnr_peak_1_db','ssim','status'])
        for variant in variants:
            for method, result, status in [('GUGIS',variant,'local-native-readback'),('MultiPatch',variant['multipatch'],'file-format-readback-only')]:
                writer.writerow([method,variant['stride_m'],result['bytes'],*[result['metrics'][key] for key in ['rmse_m','mae_m','p95_absolute_m','max_absolute_m','psnr_peak_1_db','ssim']],status])
        writer.writerow(['SPG','',report['spg']['bytes'],*[report['spg']['metrics'][key] for key in ['rmse_m','mae_m','p95_absolute_m','max_absolute_m','psnr_peak_1_db','ssim']],'local-pretrained-cpu-replay'])
    (figures / 'spg-recovery-sidecar.json').write_text(json.dumps(sidecar, separators=(',', ':'))+'\n', encoding='utf-8')
    print(json.dumps({'report_sha256': hashlib.sha256(content).hexdigest(), 'spg': report['spg']['metrics'],
        'variants': [{'id': row['id'], 'bytes': row['bytes'], 'rmse_m': row['metrics']['rmse_m']} for row in variants]}))


if __name__ == '__main__':
    main()

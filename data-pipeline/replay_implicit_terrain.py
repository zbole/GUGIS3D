"""Safely replay the author's two public weights; no notebook or pickle execution.

Requires isolated CPU torch, numpy and Pillow. Training time is not measured.
The reference clone and all weights stay outside the published repository.
"""
import argparse
import hashlib
import json
import platform
import time
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from torch.nn import functional as F

SOURCE_SHA = 'a7d90ba9b42712624d82cdfb3b7beae2ef7a2493f88d16846dea82fd8d1bc30d'
REPO_REVISION = 'ef5f180f0ec3582ddba4e71a1f0faa3dced2a40c'
WEIGHT_SHAS = {
    'shape_model': 'cde34bf0f1e63f64408c13a65086317525968c6ae6a7bd9c02e5dcd2f7793628',
    'geo_model': 'bd5a2170be1fdce28e8a95f00d9221629c08af206a66649404556beef2f8a07f',
}


def forward(state, coords):
    for layer in range(4):
        coords = torch.sin(30 * F.linear(coords, state[f'net.{layer}.linear.weight'], state[f'net.{layer}.linear.bias']))
    return F.linear(coords, state['net.4.weight'], state['net.4.bias']).reshape(-1)


def evaluate(state, coords, batch):
    result = np.empty(len(coords), dtype=np.float32)
    with torch.inference_mode():
        for start in range(0, len(coords), batch):
            result[start:start + batch] = forward(state, coords[start:start + batch]).numpy()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--threads', type=int, default=8)
    args = parser.parse_args()
    torch.set_num_threads(args.threads)
    demo = args.reference / 'implicitterrain_demo'
    tif = demo / '2494_1141.tif'
    if hashlib.sha256(tif.read_bytes()).hexdigest() != SOURCE_SHA:
        raise ValueError('The reference raster is not the audited author sample')
    image = np.array(Image.open(tif))
    if image.shape != (2000, 2000) or not np.isfinite(image).all() or (image == -9999).any():
        raise ValueError('Expected the complete 2000×2000 author DEM')
    low, high = float(image.min()), float(image.max())
    normalized = (image - low) / (high - low)
    resized = np.asarray(Image.fromarray(normalized).resize((1000, 1000), Image.Resampling.BILINEAR), dtype=np.float32)
    reference = (resized - .5) / .5
    axis = torch.linspace(-1, 1, 1000)
    coords = torch.stack(torch.meshgrid(axis, axis, indexing='ij'), dim=-1).reshape(-1, 2)
    states, weights, load_times = [], [], []
    for name in ('shape_model', 'geo_model'):
        path = demo / '2494_1141' / f'{name}.pth'
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if sha != WEIGHT_SHAS[name]:
            raise ValueError(f'{name} is not the audited author weight file')
        started = time.perf_counter()
        state = torch.load(path, map_location='cpu', weights_only=True)
        shapes = [(256, 2), (256,), *[(256, 256), (256,)] * 3, (1, 256), (1,)]
        if [tuple(v.shape) for v in state.values()] != shapes or not all(torch.isfinite(v).all() for v in state.values()):
            raise ValueError('Unsupported or nonfinite SIREN state')
        load_times.append((time.perf_counter() - started) * 1000)
        states.append(state)
        weights.append({'filename': path.name, 'bytes': path.stat().st_size, 'sha256': sha})
    # Warm one batch before recording dense inference; this is not training.
    evaluate(states[0], coords[:8192], 8192)
    started = time.perf_counter()
    surface = evaluate(states[0], coords, 8192).reshape(1000, 1000)
    surface_ms = (time.perf_counter() - started) * 1000
    residual = surface - reference
    rmin, rmax = float(residual.min()), float(residual.max())
    print(json.dumps({'stage': 'surface', 'elapsed_ms': surface_ms, 'residual_range': [rmin, rmax]}), flush=True)
    started = time.perf_counter()
    geometry = evaluate(states[1], coords, 8192).reshape(1000, 1000)
    geometry_ms = (time.perf_counter() - started) * 1000
    spg = surface - (geometry * .5 + .5) * (rmax - rmin) - rmin
    # A deterministic query batch, CPU only. Warmup excluded; five repetitions.
    rng = np.random.default_rng(20261004)
    query = torch.from_numpy(rng.uniform(-1, 1, (4096, 2)).astype(np.float32))
    for state in states:
        evaluate(state, query, 8192)
    timings = []
    for _ in range(5):
        started = time.perf_counter()
        a, b = (evaluate(state, query, 8192) for state in states)
        values = a - (b * .5 + .5) * (rmax - rmin) - rmin
        timings.append((time.perf_counter() - started) * 1000)
    metadata = {'schema': 'gugis-implicit-replay-v1', 'reference_repo_revision': REPO_REVISION,
        'source_sha256': SOURCE_SHA, 'source_bytes': tif.stat().st_size, 'source_shape': [2000, 2000],
        'reference_shape': [1000, 1000], 'reference_normalized_min_max': [float(reference.min()), float(reference.max())],
        'height_range_m': [low, high], 'residual_range_normalized': [rmin, rmax], 'crs': 'EPSG:2056',
        'reference_pixel_size_m': 1, 'reference_pixel_centres': [2494000.5, 1141999.5],
        'preprocessing': 'PIL float32 normalize to [0,1], BILINEAR 2000→1000, (value−0.5)/0.5; row-first torch linspace [-1,1]',
        'reconstruction': 'surface − (geometry×0.5+0.5)×(residual_max−residual_min) − residual_min',
        'device': 'CPU', 'torch': torch.__version__, 'python': platform.python_version(), 'platform': platform.platform(),
        'threads': args.threads, 'batch_size': 8192, 'weights': weights, 'weight_load_ms': load_times,
        'dense_inference_ms': surface_ms + geometry_ms, 'query_count': 4096, 'query_seed': 20261004,
        'query_repetitions_ms': timings, 'training_ms': None,
        'timing_scope': 'pretrained CPU inference; excludes source preprocessing and training; includes both forward passes and residual recovery'}
    args.output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.output / 'replay.npz', reference=reference, spg=spg, surface=surface, query=query.numpy(), query_values=values)
    (args.output / 'replay.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metadata), flush=True)


if __name__ == '__main__':
    main()

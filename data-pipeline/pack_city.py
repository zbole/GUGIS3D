"""Losslessly convert City 1.0 / 1.1 into a shared-geometry City 1.1 archive."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.services.city_archive import load_city, pack_city


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error("Choose a separate output file; the input is preserved.")
    original = load_city(args.input.read_bytes())
    content, stats = pack_city(original)
    if load_city(content) != original:
        raise ValueError("Roundtrip verification failed; output was not written")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(content)
    print(json.dumps(stats, indent=2))
    print(args.output.resolve())

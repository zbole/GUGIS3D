"""Independent authoring CLI. No web server or renderer required."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.studio_models import BuildingParameters
from app.services.building_generator import document_bytes, generate_building, statistics


def main():
    parser = argparse.ArgumentParser(description="Generate a semantic 3D building object file")
    parser.add_argument("--kind", choices=["tower", "villa", "georgian", "victorian", "wills", "cabot", "cathedral"], default="tower")
    parser.add_argument("--floors", type=int, default=12)
    parser.add_argument("--units", type=int, default=2)
    parser.add_argument("--floor-height", type=float, default=3.2)
    parser.add_argument("--scale", type=float, default=1)
    parser.add_argument("--name", default="Semantic residential building")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    params = BuildingParameters(kind=args.kind, floors=args.floors, units=args.units, floor_height=args.floor_height, name=args.name, scale=args.scale)
    document = generate_building(params)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(document_bytes(document))
    print(args.output.resolve())
    print(statistics(document))


if __name__ == "__main__":
    main()

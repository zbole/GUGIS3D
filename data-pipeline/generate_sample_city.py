from pathlib import Path
import json


SOURCE = Path(__file__).resolve().parents[1] / "backend" / "data" / "sample_gugis_objects.json"
TARGET = Path(__file__).resolve().parents[1] / "frontend" / "src" / "data" / "sample_gugis_objects.json"


def main() -> None:
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    TARGET.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Copied {len(payload['objects'])} objects to {TARGET}")


if __name__ == "__main__":
    main()

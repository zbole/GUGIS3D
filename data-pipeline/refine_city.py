"""Offline, non-destructive structural refinement of an existing city file."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT / "backend"))
from app.services.city_archive import load_city, archive_bytes
from app.services.urban_detail import refine_city

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    if args.input.resolve()==args.output.resolve():
        parser.error("Choose a separate output file; the input is preserved.")
    source=load_city(args.input.read_bytes())
    osm=json.loads((ROOT / "backend/data/bristol-osm.json").read_text(encoding="utf-8"))
    tags={str(e["id"]):e.get("tags",{}) for e in osm["elements"]}
    result=refine_city(source,tags)
    payload=archive_bytes(result)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_bytes(payload)
    print(json.dumps({"buildings":len(result.instances),"detailed":sum(result.assets[i.asset].parameters.kind!="footprint" for i in result.instances),
                      "components":sum(sum(n.template is not None for n in result.assets[i.asset].nodes) for i in result.instances),"bytes":len(payload)}))

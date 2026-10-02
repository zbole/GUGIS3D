"""Rebuild the starting city from local source data, without a web server."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.services.city_generator import seed_city
from app.services.city_archive import archive_bytes

parser=argparse.ArgumentParser(description='Build a self-contained Bristol GUGIS city project')
parser.add_argument('--output',required=True,type=Path)
args=parser.parse_args()
city=seed_city();content=archive_bytes(city)
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_bytes(content)
print(f'{len(city.instances)} instances / {len(city.assets)} assets / {len(content)} bytes')
print(args.output.resolve())

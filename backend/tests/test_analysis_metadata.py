"""Analysis metadata must survive the existing city archive/save contract."""
import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.routers import city as routes
from app.services.city_archive import archive_bytes, load_city


KEY = "gugis_path_analyses_v1"


def analysis_text():
    # Backend treats the versioned analysis envelope as opaque metadata. The
    # frontend's engine/store tests validate its numerical values and schema.
    record = dict(
        id="profile-1", name="公园剖面 / NoData", createdAt="2026-09-23T08:00:00.000Z",
        points=[dict(longitude=-2.603, latitude=51.454, altitude=0),
                dict(longitude=-2.602, latitude=51.454, altitude=0)],
        spacing=60, terrainFingerprint="terrain-v1:test", algorithm="native-profile/1",
        coordinateSystem="WGS84_DEGREES_LOCAL_HEIGHT_METERS",
        source={"文件名": "合成.asc", "许可": "演示数据"}, referenceHeight=100,
        result=dict(horizontalDistance=69, spatialDistance=69, elevationChange=0,
                    surfaceDistance=None, ascent=None, descent=None, coverage=0.9,
                    sampleSpacing=69, terrainName="合成平面", verticalDatum="ODN",
                    samples=[dict(distance=0, height=100, slope=0, patch="left", kind="ruled-strip"),
                             dict(distance=69, height=100, slope=0, patch="right",
                                  kind="ruled-strip", gapBefore=True)]),
    )
    return json.dumps(dict(version=1, records=[record]), ensure_ascii=False, indent=2)


def city_payload():
    return dict(
        format="gugis-city", version="1.0", coordinate_system="ENU_METERS_WGS84",
        name="Analysis metadata fixture", assets={}, instances=[], roads=[],
        metadata={"既有来源": "原样保留", KEY: analysis_text()},
        environment=dict(version="1.0", feature_assets={}, features=[], drape_buildings=True,
            terrain=dict(version="1.0", name="合成平面", longitude=-2.603, latitude=51.454,
                         vertical_datum="ODN", reference_height=100, demonstration=True,
                         source={"文件名": "合成.asc"}, points=[[0, 0, 100], [0, 10, 100],
                            [10, 0, 100], [10, 10, 100]],
                         patches=[dict(id="strip", kind="ruled-strip", left=[0, 2], right=[1, 3])])),
    )


class AnalysisMetadataTests(unittest.TestCase):
    def test_archive_roundtrip_preserves_analysis_envelope_verbatim(self):
        payload = city_payload()
        before = copy.deepcopy(payload)
        original = load_city(payload)
        encoded = archive_bytes(original)
        restored = load_city(encoded)
        self.assertEqual(json.loads(encoded)["version"], "1.2")
        self.assertEqual(restored.metadata, payload["metadata"])
        self.assertEqual(restored.metadata[KEY], analysis_text())
        self.assertEqual(restored.environment, original.environment)
        self.assertEqual(payload, before)
        self.assertEqual(archive_bytes(restored), encoded)

    def test_save_reload_export_and_validation_preserve_analysis_in_temporary_project(self):
        payload = city_payload()
        initial = copy.deepcopy(payload)
        initial["metadata"].pop(KEY)
        with TemporaryDirectory() as directory:
            directory = Path(directory)
            (directory / "current.gugis.json").write_bytes(archive_bytes(load_city(initial)))
            with patch.multiple(routes, CITY_DIR=directory, _validated_snapshot=None,
                                _archive_snapshot=None), TestClient(app) as client:
                revision = client.get("/city/current").json()["revision"]
                response = client.post("/city/current", json=dict(base_revision=revision, document=payload))
                self.assertEqual(response.status_code, 200, response.text)
                restored = client.get("/city/current").json()["document"]
                self.assertEqual(restored["metadata"], payload["metadata"])
                exported = client.get("/city/export")
                self.assertEqual(exported.status_code, 200)
                self.assertEqual(exported.json()["metadata"], payload["metadata"])
                validated = client.post("/city/validate", json=exported.json())
                self.assertEqual(validated.status_code, 200, validated.text)
                self.assertEqual(validated.json()["document"]["metadata"], payload["metadata"])
                self.assertEqual(load_city((directory / "current.gugis.json").read_bytes()).metadata,
                                 payload["metadata"])

    def test_unrecognized_metadata_text_is_kept_for_frontend_validation_and_recovery(self):
        payload = city_payload()
        payload["metadata"][KEY] = "{broken or future analysis envelope"
        self.assertEqual(load_city(archive_bytes(load_city(payload))).metadata, payload["metadata"])


if __name__ == "__main__":
    unittest.main()

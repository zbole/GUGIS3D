import json
import os
from functools import lru_cache
from pathlib import Path

from .schemas import GugisObject, Layer


DEFAULT_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "sample_gugis_objects.json"


class JsonObjectRepository:
    def __init__(self, data_path: str | Path = DEFAULT_DATA_PATH) -> None:
        env_path = os.getenv("GUGIS_DATA_PATH")
        self.data_path = Path(env_path) if env_path else Path(data_path)
        self._objects: list[GugisObject] | None = None

    def _load(self) -> list[GugisObject]:
        if self._objects is None:
            with self.data_path.open("r", encoding="utf-8") as fp:
                payload = json.load(fp)
            self._objects = [GugisObject.model_validate(item) for item in payload["objects"]]
        return self._objects

    def list_objects(self, layer_id: str | None = None) -> list[GugisObject]:
        objects = self._load()
        if layer_id:
            return [obj for obj in objects if obj.layer_id == layer_id]
        return list(objects)

    def get_object(self, object_id: str) -> GugisObject | None:
        return next((obj for obj in self._load() if obj.object_id == object_id), None)

    def list_layers(self) -> list[Layer]:
        labels = {
            "buildings": "Buildings",
            "roads": "Roads",
            "parks": "Green Areas",
            "templates": "Template Objects",
        }
        counts: dict[str, int] = {}
        opacity: dict[str, float] = {}
        for obj in self._load():
            counts[obj.layer_id] = counts.get(obj.layer_id, 0) + 1
            opacity.setdefault(obj.layer_id, obj.opacity)

        layers = [
            Layer(layer_id=layer_id, name=labels.get(layer_id, layer_id.title()), object_count=count, opacity=opacity[layer_id])
            for layer_id, count in sorted(counts.items())
        ]
        layers.extend(
            [
                Layer(layer_id="terrain", name="Terrain", object_count=0, opacity=0.65, placeholder=True),
                Layer(layer_id="ai_results", name="AI Results", object_count=0, opacity=1.0, placeholder=True),
            ]
        )
        return layers


@lru_cache
def get_repository() -> JsonObjectRepository:
    return JsonObjectRepository()

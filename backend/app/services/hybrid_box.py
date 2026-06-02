import math

from ..schemas import GugisObject, HybridBoxQuery


def distance_2d_meters(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    hav = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(hav))


def distance_3d_meters(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt(distance_2d_meters(a, b) ** 2 + (a[2] - b[2]) ** 2)


def intersects_hybrid_box(obj: GugisObject, query: HybridBoxQuery) -> bool:
    if query.layer_id and obj.layer_id != query.layer_id:
        return False

    center = obj.hybrid_box.center
    if query.radius_2d is not None:
        if distance_2d_meters(center, query.center) > query.radius_2d + obj.hybrid_box.radius_2d:
            return False

    if query.radius_3d is not None:
        if distance_3d_meters(center, query.center) > query.radius_3d + obj.hybrid_box.radius_3d:
            return False

    return True

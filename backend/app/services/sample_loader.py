from ..database import get_repository
from ..schemas import GugisObject, Layer


def load_sample_objects() -> list[GugisObject]:
    return get_repository().list_objects()


def load_sample_layers() -> list[Layer]:
    return get_repository().list_layers()

from enum import IntEnum, StrEnum


class ShapeType(IntEnum):
    NULL = 0
    POINT = 10000
    LINE = 20000
    SURFACE = 30000
    BODY = 40000
    COMPLEX_OBJECT = 50000
    MIX = 60000
    TEMPLATE = 70000


class StructureType(StrEnum):
    FUNCTION = "FunctionStructure"
    TEMPLATE = "TemplateStructure"
    DISCRETE = "DiscreteStructure"
    COMPOSITE = "CompositeStructure"
    BOOLEAN = "BooleanStructure"

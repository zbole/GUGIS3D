export enum ShapeType {
  Null = 0,
  Point = 10000,
  Line = 20000,
  Surface = 30000,
  Body = 40000,
  ComplexObject = 50000,
  Mix = 60000,
  Template = 70000
}

export type StructureType =
  | "FunctionStructure"
  | "TemplateStructure"
  | "DiscreteStructure"
  | "CompositeStructure"
  | "BooleanStructure";

export type Coordinate3 = [number, number, number];

export interface Pose {
  strike: number;
  dip: number;
  roll?: number;
}

export interface HybridBox {
  center: Coordinate3;
  radius_xyz: Coordinate3;
  radius_2d: number;
  radius_3d: number;
}

export interface GugisObject {
  object_id: string;
  layer_id: string;
  name: string;
  shape_type: ShapeType;
  structure_type: StructureType;
  main_type: number;
  sub_type: number;
  coordinate_mode: "global" | "local";
  base_point: Coordinate3;
  pose: Pose;
  hybrid_box: HybridBox;
  geometry: Record<string, unknown>;
  attributes: Record<string, unknown>;
  visible: boolean;
  opacity: number;
}

export interface Layer {
  layer_id: string;
  name: string;
  object_count: number;
  visible: boolean;
  opacity: number;
  placeholder: boolean;
}

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export type MeasurementMode = "none" | "distance" | "height";

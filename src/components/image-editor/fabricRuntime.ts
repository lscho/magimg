import {
  Canvas,
  IText,
  PencilBrush,
  Point,
  Rect,
  StaticCanvas,
  version
} from "fabric/es";

export const fabricRuntime = {
  Canvas,
  IText,
  PencilBrush,
  Point,
  Rect,
  StaticCanvas,
  version
};

export type FabricRuntime = typeof fabricRuntime;

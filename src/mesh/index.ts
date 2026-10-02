// The mesh engine's public API. Import from 'src/mesh' only.

export { createMeshRunner } from './runner';
export { createMeshAnimationRunner } from './animationRunner';
export { DEFAULT_MESH_CONFIG, MESH_POLYGON_DEFAULTS, MESH_QUALITY_PRESETS, checkMeshConfig, type MeshQuality } from './config';
export { frameSeed, parseMeshAnimationJSON, parseMeshJSON } from './animationPlan';
export { drawMesh } from './drawMesh';
export { meshToSVG } from './toSVG';
export { meshToAnimatedSVG } from './toAnimatedSVG';
export { rasterizeMesh } from './rasterizeMesh';
export type {
  ImportanceInfo,
  MeshAnimationEvents,
  MeshAnimationResult,
  MeshAnimationRunner,
  MeshAnimationSettings,
  MeshConfig,
  MeshPolygon,
  MeshResult,
  MeshTriangle,
  MeshRunner,
  MeshRunnerEvents,
  MeshRunnerOptions,
  MeshRunnerState,
} from './types';

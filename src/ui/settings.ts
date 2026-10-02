// Reading and writing the settings form.

import { DEFAULT_CONFIG, QUALITY_PRESETS, type Quality } from '../engine/config';
import { SHAPE_TYPES, type AnimationSettings, type RunConfig, type ShapeType } from '../engine/types';
import {
  DEFAULT_MESH_CONFIG,
  MESH_POLYGON_DEFAULTS,
  MESH_QUALITY_PRESETS,
  type MeshAnimationSettings,
  type MeshConfig,
} from '../mesh';
import type { Output, Style } from './runs/activeRun';
import { DEFAULT_IMPORTANCE_STRENGTH, importanceStrength } from '../importance';

/** The output choice: a single picture or a seed animation. */
export type Mode = Output;

export interface Settings {
  /** Overlapping shapes, triangle mesh or polygon mosaic. */
  style: Style;
  mode: Mode;
  /** Settings for the overlapping-shapes style. */
  config: RunConfig;
  /** Settings for the triangle-mesh and polygon-mosaic styles (cells says which). */
  meshConfig: MeshConfig;
  /** Longest side of the working image in pixels. */
  workingSize: number;
  /** Used in animation mode with the shapes style. */
  animation: AnimationSettings;
  /** Used in animation mode with the triangle-mesh and polygon-mosaic styles. */
  meshAnimation: MeshAnimationSettings;
  /** "Detail focus" strength, 0 (off) to 1. */
  detail: number;
}

const MAX_SEED = 4294967295;

/** Help text that depends on the style. One element each on the page, so only one style's copy shows. */
const STYLE_TEXT: Record<Style, { style: string; points: string; animation: string }> = {
  shapes: {
    style: 'Translucent shapes laid on top of each other.',
    points: '',
    animation:
      'The photo is made once per frame, each with the next seed, and played as a loop. Shapes in the shared ' +
      'start are the same in every frame and hold still; the rest shimmer.',
  },
  mesh: {
    style: 'Flat triangles that fit together with no gaps or overlaps.',
    points: 'Corners of the triangles; about twice as many triangles.',
    animation:
      'The picture is made once per frame, each with the next seed, and played as a loop. Variation sets how ' +
      'much the frames differ: 0 holds still, 1 makes every frame a different layout.',
  },
  polygons: {
    style: 'Flat polygons that fit together like a mosaic or stained glass.',
    points: 'One polygon per point.',
    animation:
      'The picture is made once per frame, each with the next seed, and played as a loop. Variation sets how ' +
      'much the frames differ: 0 holds still, 1 makes every frame a different layout.',
  },
};

/** Default number of points for a mesh style. */
function defaultPoints(style: 'mesh' | 'polygons'): number {
  return style === 'polygons' ? MESH_POLYGON_DEFAULTS.points : DEFAULT_MESH_CONFIG.points;
}

/** The settings form, as the rest of the page uses it. */
export interface SettingsForm {
  read(): Settings;
  setSeed(seed: number): void;
  setShapeCount(count: number): void;
  setShapeTypes(types: string[]): void;
  setQuality(quality: string): void;
  setMode(mode: Mode): void;
  /** The chosen output (without tidying the other fields as read() does). */
  mode(): Mode;
  setStyle(style: Style): void;
  /** The chosen style. */
  style(): Style;
  setPoints(points: number): void;
  /** Mesh animation variation, 0 to 1. */
  setVariation(variation: number): void;
  /** The chosen working size (read from its menu even while the form is disabled). */
  workingSize(): number;
  /** Called when the style changes. */
  onStyleChange: ((style: Style) => void) | null;
  setWorkingSize(size: number): void;
  /** Detail focus strength as given (e.g. ?importance=), read with importanceStrength(). */
  setDetail(strength: string | number): void;
  setFrames(frames: number): void;
  setShared(shared: number): void;
  setEnabled(enabled: boolean): void;
}

export function setUpSettings(form: HTMLFormElement): SettingsForm {
  const fields = form.querySelector('fieldset') as HTMLFieldSetElement;
  const opacity = form.elements.namedItem('opacity') as HTMLInputElement;
  const opacityOut = form.elements.namedItem('opacityOut') as HTMLOutputElement;
  const seedInput = form.elements.namedItem('seed') as HTMLInputElement;
  const shapesInput = form.elements.namedItem('shapes') as HTMLInputElement;
  const randomSeed = form.querySelector('#random-seed') as HTMLButtonElement;
  const typeBoxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="shapeType"]'));
  const modeRadios = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
  const styleRadios = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="style"]'));
  const pointsInput = form.elements.namedItem('points') as HTMLInputElement;
  const workingSizeSelect = form.elements.namedItem('workingSize') as HTMLSelectElement;
  // Fields that only apply to some styles list them: data-style="shapes", or
  // data-style="mesh polygons" for both mesh-engine styles.
  const styleOnly = Array.from(form.querySelectorAll<HTMLElement>('[data-style]'));
  const variationInput = form.elements.namedItem('variation') as HTMLInputElement;
  const variationOut = form.elements.namedItem('variationOut') as HTMLOutputElement;
  const animationFields = form.querySelector('#animation-settings') as HTMLElement;
  const framesInput = form.elements.namedItem('frames') as HTMLInputElement;
  const sharedInput = form.elements.namedItem('shared') as HTMLInputElement;
  const sharedOut = form.elements.namedItem('sharedOut') as HTMLOutputElement;
  const detailInput = form.elements.namedItem('detail') as HTMLInputElement;
  const detailOut = form.elements.namedItem('detailOut') as HTMLOutputElement;

  form.addEventListener('submit', (event) => event.preventDefault());

  // Opacity is stored as 1-255 but shown as a percentage.
  function showOpacity(): void {
    opacityOut.value = `${Math.round((Number(opacity.value) / 255) * 100)}%`;
  }
  opacity.addEventListener('input', showOpacity);
  showOpacity();

  // At least one shape type must stay ticked.
  for (const box of typeBoxes) {
    box.addEventListener('change', () => {
      if (!typeBoxes.some((b) => b.checked)) box.checked = true;
    });
  }

  // The slider holds whole percent; it starts at the shared default.
  detailInput.value = String(Math.round(DEFAULT_IMPORTANCE_STRENGTH * 100));
  function showDetail(): void {
    detailOut.value = detailInput.value === '0' ? 'Off' : `${detailInput.value}%`;
  }
  detailInput.addEventListener('input', showDetail);
  showDetail();

  // Animation settings only show in animation mode.
  function showMode(): void {
    animationFields.hidden = currentMode() !== 'animation';
  }

  // Triangles default to 300 points, polygons to 600 (a polygon mosaic needs
  // about twice the points for the same detail). A number typed in is kept
  // for that style only.
  // Kept as typed (even if not a number yet); read() checks it and falls back
  // to the current style's default.
  const pointsByStyle = { mesh: String(defaultPoints('mesh')), polygons: String(defaultPoints('polygons')) };
  pointsInput.addEventListener('input', () => {
    const style = currentStyle();
    if (style === 'mesh' || style === 'polygons') pointsByStyle[style] = pointsInput.value;
  });

  // While a run is in progress the form is disabled, so nobody can click or
  // key a different style or output. A script could still set a radio, so
  // remember the chosen ones and put them back if they change while locked.
  let locked = false;
  const styleHint = form.querySelector('#style-hint') as HTMLElement;
  const pointsHint = form.querySelector('#points-hint') as HTMLElement;
  const animationHint = form.querySelector('#animation-hint') as HTMLElement;

  function currentStyle(): Style {
    const value = styleRadios.find((radio) => radio.checked)?.value;
    return value === 'mesh' || value === 'polygons' ? value : 'shapes';
  }

  /** Show only the fields that apply to the chosen style. */
  function showStyle(): void {
    const style = currentStyle();
    for (const element of styleOnly) element.hidden = !(element.dataset.style ?? '').split(' ').includes(style);
    styleHint.textContent = STYLE_TEXT[style].style;
    pointsHint.textContent = STYLE_TEXT[style].points;
    animationHint.textContent = STYLE_TEXT[style].animation;
    // Each mesh style keeps its own number of points.
    if (style === 'mesh' || style === 'polygons') pointsInput.value = pointsByStyle[style];
    showMode();
  }

  // Variation is stored 0-100 on the slider and used as 0-1.
  function showVariation(): void {
    variationOut.value = (Number(variationInput.value) / 100).toFixed(2);
  }
  variationInput.addEventListener('input', showVariation);
  showVariation();
  function currentMode(): Mode {
    return modeRadios.find((radio) => radio.checked)?.value === 'animation' ? 'animation' : 'single';
  }
  let chosenStyle = currentStyle();
  let chosenMode = currentMode();
  for (const radio of styleRadios) {
    radio.addEventListener('change', () => {
      if (locked) {
        for (const r of styleRadios) r.checked = r.value === chosenStyle;
        return;
      }
      chosenStyle = currentStyle();
      showStyle();
      settings.onStyleChange?.(chosenStyle);
    });
  }
  for (const radio of modeRadios) {
    radio.addEventListener('change', () => {
      if (locked) {
        for (const r of modeRadios) r.checked = r.value === chosenMode;
        return;
      }
      chosenMode = currentMode();
      showMode();
    });
  }
  showStyle();

  // The shared-start slider runs from 0 to the number of shapes. Until it is
  // moved by hand it stays at a third of the shapes.
  let sharedMoved = false;
  function showShared(): void {
    const shared = Number(sharedInput.value);
    const shapes = Math.max(1, Number(shapesInput.value) || 1);
    sharedOut.value = `${shared} (${Math.round((shared / shapes) * 100)}%)`;
  }
  function fitSharedToShapes(): void {
    const shapes = Math.max(1, Math.min(5000, Math.round(Number(shapesInput.value)) || DEFAULT_CONFIG.maxShapes));
    sharedInput.max = String(shapes);
    if (!sharedMoved) sharedInput.value = String(Math.round(shapes / 3));
    else if (Number(sharedInput.value) > shapes) sharedInput.value = String(shapes);
    showShared();
  }
  sharedInput.addEventListener('input', () => {
    sharedMoved = true;
    showShared();
  });
  shapesInput.addEventListener('input', fitSharedToShapes);
  fitSharedToShapes();

  randomSeed.addEventListener('click', () => {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    seedInput.value = String(value[0]);
  });

  const settings: SettingsForm = {
    read() {
      const data = new FormData(form);
      const shapeTypes = typeBoxes.filter((b) => b.checked).map((b) => b.value as ShapeType);
      const quality = (data.get('quality') as Quality | null) ?? 'standard';
      const config: RunConfig = {
        ...DEFAULT_CONFIG,
        ...QUALITY_PRESETS[quality],
        shapeTypes: shapeTypes.length > 0 ? shapeTypes : [SHAPE_TYPES[0]],
        alpha: wholeNumber(data.get('opacity'), 1, 255, DEFAULT_CONFIG.alpha),
        maxShapes: wholeNumber(data.get('shapes'), 1, 5000, DEFAULT_CONFIG.maxShapes),
        seed: wholeNumber(data.get('seed'), 0, MAX_SEED, DEFAULT_CONFIG.seed),
      };
      const animation: AnimationSettings = {
        frames: wholeNumber(data.get('frames'), 2, 60, 12),
        shared: wholeNumber(data.get('shared'), 0, config.maxShapes, Math.round(config.maxShapes / 3)),
      };
      // Show the values actually used, in case they were tidied up.
      seedInput.value = String(config.seed);
      shapesInput.value = String(config.maxShapes);
      framesInput.value = String(animation.frames);
      // Polygon defaults add cells: 'polygons'; triangle configs have no cells
      // field at all, exactly as before polygons existed.
      const meshConfig: MeshConfig = {
        ...(currentStyle() === 'polygons' ? MESH_POLYGON_DEFAULTS : DEFAULT_MESH_CONFIG),
        ...MESH_QUALITY_PRESETS[quality],
        seed: config.seed,
        points: wholeNumber(
          data.get('points'),
          8,
          5000,
          defaultPoints(currentStyle() === 'polygons' ? 'polygons' : 'mesh'),
        ),
      };
      pointsInput.value = String(meshConfig.points);
      const styleNow = currentStyle();
      if (styleNow === 'mesh' || styleNow === 'polygons') pointsByStyle[styleNow] = pointsInput.value;
      const meshAnimation: MeshAnimationSettings = {
        frames: animation.frames,
        variation: wholeNumber(data.get('variation'), 0, 100, 30) / 100,
      };
      return {
        style: currentStyle(),
        mode: currentMode(),
        config,
        meshConfig,
        workingSize: settings.workingSize(),
        animation,
        meshAnimation,
        detail: wholeNumber(data.get('detail'), 0, 100, 0) / 100,
      };
    },
    workingSize: () => wholeNumber(workingSizeSelect.value, 16, 2048, 256),
    style: () => currentStyle(),
    setStyle(style) {
      if (locked) return;
      for (const radio of styleRadios) radio.checked = radio.value === style;
      chosenStyle = style;
      showStyle();
      settings.onStyleChange?.(style);
    },
    setPoints(points) {
      pointsInput.value = String(points);
      const style = currentStyle();
      if (style === 'mesh' || style === 'polygons') pointsByStyle[style] = String(points);
    },
    setVariation(variation) {
      variationInput.value = String(Math.round(Math.min(1, Math.max(0, variation)) * 100));
      showVariation();
    },
    onStyleChange: null,
    setSeed(seed) {
      seedInput.value = String(seed);
    },
    setShapeCount(count) {
      shapesInput.value = String(count);
      fitSharedToShapes();
    },
    setMode(mode) {
      if (locked) return;
      for (const radio of modeRadios) radio.checked = radio.value === mode;
      chosenMode = mode;
      showMode();
    },
    mode: () => currentMode(),
    setDetail(strength) {
      // The same rule as the scripts' --importance: clamped to 0-1, whole percent, 0 = off.
      detailInput.value = String(Math.round(importanceStrength(strength) * 100));
      showDetail();
      detailInput.dispatchEvent(new Event('input'));
    },
    setWorkingSize(size) {
      (form.elements.namedItem('workingSize') as HTMLSelectElement).value = String(size);
    },
    setFrames(frames) {
      framesInput.value = String(frames);
    },
    setShared(shared) {
      sharedMoved = true;
      sharedInput.value = String(shared);
      showShared();
    },
    setShapeTypes(types) {
      if (!typeBoxes.some((b) => types.includes(b.value))) return; // keep at least one ticked
      for (const box of typeBoxes) box.checked = types.includes(box.value);
    },
    setQuality(quality) {
      const radio = form.querySelector<HTMLInputElement>(`input[name="quality"][value="${CSS.escape(quality)}"]`);
      if (radio) radio.checked = true;
    },
    setEnabled(enabled) {
      fields.disabled = !enabled;
      locked = !enabled;
    },
  };
  return settings;
}

/** Parse a form value as a whole number within [min, max], or use the fallback. */
function wholeNumber(raw: FormDataEntryValue | null, min: number, max: number, fallback: number): number {
  const value = Math.round(Number(raw));
  if (raw === null || raw === '' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

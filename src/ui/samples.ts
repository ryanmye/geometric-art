// The sample pictures listed in public/samples/samples.json: a small menu of
// thumbnails, and the credit line for the chosen one.

export interface SampleInfo {
  /** File name in public/samples, e.g. "mona-lisa.jpg". */
  file: string;
  title: string;
  creator: string;
  year: string;
  licence: string;
  /** Where the image comes from (a web page). */
  source: string;
  width: number;
  height: number;
}

const SAMPLES_URL = 'samples/samples.json';

export async function loadSampleList(): Promise<SampleInfo[]> {
  const response = await fetch(SAMPLES_URL);
  if (!response.ok) throw new Error(`Could not load the list of samples (HTTP ${response.status}).`);
  return (await response.json()) as SampleInfo[];
}

/** Relative URL of a sample image. */
export function sampleUrl(sample: SampleInfo): string {
  return `samples/${sample.file}`;
}

/** Short name used in ?demo&sample=..., the file name without its extension. */
export function sampleName(sample: SampleInfo): string {
  return sample.file.replace(/\.[^.]+$/, '');
}

/**
 * Fill the menu with one thumbnail button per sample. The thumbnails only
 * start loading when the menu is first opened.
 */
export function setUpSamplePicker(
  menu: HTMLDetailsElement,
  grid: HTMLElement,
  samples: SampleInfo[],
  onPick: (sample: SampleInfo) => void,
): void {
  grid.replaceChildren();
  const images: HTMLImageElement[] = [];
  for (const sample of samples) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample-thumb';
    button.title = `${sample.title}, ${sample.creator}`;
    button.dataset.sample = sampleName(sample);
    const image = document.createElement('img');
    image.alt = sample.title;
    image.dataset.src = sampleUrl(sample);
    images.push(image);
    button.append(image);
    button.addEventListener('click', () => {
      menu.open = false;
      onPick(sample);
    });
    grid.append(button);
  }
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    for (const image of images) {
      if (!image.src && image.dataset.src) image.src = image.dataset.src;
    }
  });
}

/** Show who made the sample and where it comes from, with a link. */
export function showSampleCredit(element: HTMLElement, sample: SampleInfo): void {
  element.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = sample.title;
  const link = document.createElement('a');
  link.href = sample.source;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Source';
  element.append(title, `, ${sample.creator}, ${sample.year}. ${sample.licence}. `, link);
}

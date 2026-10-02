// The live numbers under the buttons. Each kind of run decides which numbers
// it shows (see src/ui/runs/); this file only puts them on the page.

export interface StatRow {
  /** Short id: the value gets the element id "stat-<key>" (handy for scripts). */
  key: string;
  label: string;
  value: string;
  /** Optional explanation shown on hover. */
  title?: string;
}

/** What shows before any run. */
const EMPTY_ROWS: StatRow[] = [
  { key: 'shapes', label: 'Shapes', value: '–' },
  { key: 'error', label: 'Error', value: '–' },
  { key: 'speed', label: 'Speed', value: '–' },
  { key: 'time', label: 'Time', value: '–' },
];

export function setUpStats(list: HTMLElement): { show(rows: StatRow[] | null): void } {
  return {
    show(rows) {
      const items = (rows ?? EMPTY_ROWS).map((row) => {
        const item = document.createElement('div');
        const label = document.createElement('dt');
        label.textContent = row.label;
        if (row.title) label.title = row.title;
        const value = document.createElement('dd');
        value.id = `stat-${row.key}`;
        value.textContent = row.value;
        item.append(label, value);
        return item;
      });
      list.replaceChildren(...items);
    },
  };
}

/** The error as a percentage of the largest possible difference, e.g. "4.12%". */
export function errorStat(score: number): StatRow {
  return {
    key: 'error',
    label: 'Error',
    value: `${(score * 100).toFixed(2)}%`,
    title: 'Root-mean-square colour difference from the photo',
  };
}

export function timeStat(elapsedMs: number): StatRow {
  return { key: 'time', label: 'Time', value: formatDuration(elapsedMs) };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 1) return `${(ms / 1000).toFixed(1)} s`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

// Dot-directories inside the project may hold other checkouts of this
// repository, each with its own tests and node_modules. Keep them out of the
// test run and the dev server's file watcher. (The dependency scan skips dot
// folders already, and tsconfig only includes src, tests and scripts.)
const insideDotDirectory = (file: string): boolean => {
  const path = relative(root, file);
  return !path.startsWith('..') && path.split(sep).some((part) => part.startsWith('.'));
};

export default defineConfig({
  // Relative base so the built site works under a GitHub Pages subpath.
  base: './',
  worker: { format: 'es' },
  // A function, not a glob: the watcher sees absolute paths, and a glob would
  // also match the project itself when it sits under a dot-directory.
  server: { watch: { ignored: [insideDotDirectory] } },
  test: {
    // Test files are matched relative to the project root.
    exclude: [...configDefaults.exclude, '**/.*/**'],
  },
});

// The two ways of running searches (a pool of web workers, or inline on the
// calling thread) look the same to the runner.

import type { RunConfig, ShapeRecord } from '../engine/types';
import type { SearchOutcome } from '../engine/searcher';

export interface Executor {
  /** True when searches run on the calling thread (the runner then yields between shapes). */
  readonly inline: boolean;
  /** Run all `config.climbs` climbs for this attempt and return the best. */
  search(shapeIndex: number, retry: number): Promise<SearchOutcome>;
  /** An accepted shape: paint it into every copy of the current picture. */
  add(record: ShapeRecord): void;
  /**
   * Start over for a new run on the same target, with a new config and
   * prefix, keeping the workers and their copy of the target (used between
   * the frames of an animation). Equivalent to creating a fresh executor.
   */
  reset(config: RunConfig, prefix: ShapeRecord[]): void;
  /** Release workers. */
  dispose(): void;
}

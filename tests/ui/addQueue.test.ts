import { describe, expect, it } from 'vitest';
import { createTaskQueue, fillRoom } from '../../src/ui/photos/addQueue';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the add queue', () => {
  it('runs tasks one after another and keeps going after a failure', async () => {
    const errors: unknown[] = [];
    const queue = createTaskQueue((error) => errors.push(error));
    const order: string[] = [];
    const first = queue.run(async () => {
      order.push('a start');
      await tick();
      order.push('a end');
    });
    const second = queue.run(async () => {
      order.push('b');
      throw new Error('b failed');
    });
    const third = queue.run(async () => {
      order.push('c');
    });
    expect(queue.pending).toBe(3);
    await expect(Promise.all([first, second, third])).resolves.toBeDefined();
    expect(order).toEqual(['a start', 'a end', 'b', 'c']);
    expect(errors).toHaveLength(1);
    expect(queue.pending).toBe(0);
    // Still usable afterwards.
    let ran = false;
    await queue.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe('filling the room under the cap', () => {
  it('keeps trying files until the room is used, so failures do not take up slots', async () => {
    // One slot left: a text file fails, the photo after it gets the slot.
    const tried: string[] = [];
    const result = await fillRoom(['notes.txt', 'a.jpg', 'b.jpg'], 1, async (name) => {
      tried.push(name);
      return name.endsWith('.jpg');
    });
    expect(tried).toEqual(['notes.txt', 'a.jpg']);
    expect(result).toEqual({ added: 1, notTried: ['b.jpg'] });
  });

  it('tries nothing when there is no room, and everything when there is enough', async () => {
    expect(await fillRoom(['a', 'b'], 0, async () => true)).toEqual({ added: 0, notTried: ['a', 'b'] });
    expect(await fillRoom(['a', 'b'], 5, async (name) => name === 'a')).toEqual({ added: 1, notTried: [] });
  });
});

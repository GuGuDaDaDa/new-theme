/** Unit coverage for pure segmented progress-bar sliding window computation. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProgressWindow } from '../../assets/js/components/gallery-progress.js';

test('returns all segments with normal scale when total <= maxVisible (2, 5, 7)', () => {
  for (const total of [2, 5, 7]) {
    for (const active of [0, Math.floor(total / 2), total - 1]) {
      const result = computeProgressWindow(total, active);
      assert.equal(result.length, total);
      assert.deepEqual(
        result.map((s) => s.index),
        Array.from({ length: total }, (_, i) => i),
      );
      assert.deepEqual(
        result.map((s) => s.active),
        Array.from({ length: total }, (_, i) => i === active),
      );
      assert.ok(result.every((s) => s.scale === 'normal'));
    }
  }
});

test('computes 7-segment sliding window and edge dots for total = 8, 12, 20 at start, middle, and end', () => {
  for (const total of [8, 12, 20]) {
    // 1. Start position (index 0): window [0..6], only right edge is scaled as 'edge'
    const startWindow = computeProgressWindow(total, 0);
    assert.equal(startWindow.length, 7);
    assert.deepEqual(
      startWindow.map((s) => s.index),
      [0, 1, 2, 3, 4, 5, 6],
    );
    assert.equal(
      startWindow.findIndex((s) => s.active),
      0,
    );
    assert.deepEqual(
      startWindow.map((s) => s.scale),
      ['normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'edge'],
    );

    // Near start (index 2): still pinned to [0..6] because 2 - 3 < 0
    const nearStart = computeProgressWindow(total, 2);
    assert.deepEqual(
      nearStart.map((s) => s.index),
      [0, 1, 2, 3, 4, 5, 6],
    );
    assert.equal(
      nearStart.findIndex((s) => s.active),
      2,
    );
    assert.deepEqual(
      nearStart.map((s) => s.scale),
      ['normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'edge'],
    );

    // 2. End position (index total - 1): window [total-7..total-1], only left edge is 'edge'
    const endWindow = computeProgressWindow(total, total - 1);
    assert.equal(endWindow.length, 7);
    assert.deepEqual(
      endWindow.map((s) => s.index),
      Array.from({ length: 7 }, (_, i) => total - 7 + i),
    );
    assert.equal(
      endWindow.findIndex((s) => s.active),
      6,
    );
    assert.deepEqual(
      endWindow.map((s) => s.scale),
      ['edge', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal'],
    );
  }

  // 3. Middle position for total = 12 (active = 5 -> start = 2, end = 8, both sides overflow)
  const mid12 = computeProgressWindow(12, 5);
  assert.equal(mid12.length, 7);
  assert.deepEqual(
    mid12.map((s) => s.index),
    [2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(
    mid12.findIndex((s) => s.active),
    3,
  );
  assert.deepEqual(
    mid12.map((s) => s.scale),
    ['edge', 'normal', 'normal', 'normal', 'normal', 'normal', 'edge'],
  );

  // 4. Middle position for total = 20 (active = 10 -> start = 7, end = 13, both sides overflow)
  const mid20 = computeProgressWindow(20, 10);
  assert.equal(mid20.length, 7);
  assert.deepEqual(
    mid20.map((s) => s.index),
    [7, 8, 9, 10, 11, 12, 13],
  );
  assert.equal(
    mid20.findIndex((s) => s.active),
    3,
  );
  assert.deepEqual(
    mid20.map((s) => s.scale),
    ['edge', 'normal', 'normal', 'normal', 'normal', 'normal', 'edge'],
  );

  // 5. Transition point for total = 8: active = 4 shifts window to [1..7], left overflows, right reaches end
  const shift8 = computeProgressWindow(8, 4);
  assert.deepEqual(
    shift8.map((s) => s.index),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(
    shift8.findIndex((s) => s.active),
    3,
  );
  assert.deepEqual(
    shift8.map((s) => s.scale),
    ['edge', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal'],
  );
});

test('clamps out-of-range active indices and handles non-positive totals gracefully', () => {
  assert.deepEqual(computeProgressWindow(0, 0), []);
  assert.deepEqual(computeProgressWindow(-3, 0), []);

  const under = computeProgressWindow(5, -2);
  assert.equal(
    under.findIndex((s) => s.active),
    0,
  );

  const over = computeProgressWindow(5, 99);
  assert.equal(
    over.findIndex((s) => s.active),
    4,
  );
});

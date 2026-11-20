import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../js/motion/history.js';
import { state, dispatch, undo, redo, history, loadProject, newMotion, active } from '../js/state.js';
test('undo/redo dan redo dihapus setelah aksi baru', () => {
  const h = createHistory(); h.record('s0', 'a'); h.record('s1', 'b');
  assert.equal(h.undo('s2'), 's1'); assert.equal(h.undo('s1'), 's0'); assert.equal(h.undo('s0'), null);
  assert.equal(h.redo('s0'), 's1'); h.record('s1', 'c'); assert.equal(h.canRedo(), false);
});
test('batas 50 langkah', () => {
  const h = createHistory(50); for (let i = 0; i < 80; i++) h.record('s' + i, 't' + i);
  let n = 0; while (h.undo('x') !== null) n++; assert.equal(n, 50);
});
test('merge: drag beruntun jadi satu langkah, jeda panjang memisah', () => {
  let t = 0; const h = createHistory(50, () => t);
  h.record('s0', 'v', true); t = 100; h.record('s1', 'v', true); t = 200; h.record('s2', 'v', true);
  assert.equal(h.undo('end'), 's0'); assert.equal(h.canUndo(), false);
  const g = createHistory(50, () => t); t = 0; g.record('a', 'v', true); t = 5000; g.record('b', 'v', true); assert.equal(g.undo('x'), 'b');
});
test('state: hanya perubahan nyata yang dicatat; undo/redo memulihkan project', () => {
  loadProject({ version: 1, modelName: 'M', motions: [], activeMotionId: null });
  assert.equal(state.project.motions.length, 1);
  dispatch(() => {}, 'noop'); assert.equal(history.canUndo(), false);
  dispatch(() => { active().name = 'Baru'; }, 'rename'); assert.equal(history.canUndo(), true);
  dispatch(s => { newMotion(); }, 'motion'); assert.equal(state.project.motions.length, 2);
  undo(); assert.equal(state.project.motions.length, 1); assert.equal(active().name, 'Baru');
  undo(); assert.notEqual(active().name, 'Baru'); redo(); assert.equal(active().name, 'Baru');
  assert.equal(undo() && undo(), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeProject, parseProject, normalizeProject } from '../js/io/project.js';
const proj = { version: 1, modelName: 'Hiyori', activeMotionId: 'b', motions: [
  { id: 'a', name: 'A', fps: 30, totalFrames: 150, loop: true, tracks: [] },
  { id: 'b', name: 'B', fps: 24, totalFrames: 48, loop: false, tracks: [{ paramId: 'P', keyframes: [{ frame: 0, value: 0, interp: 'bezier', ease: 'in', handles: { out: [1, 0], in: [-1, -2] } }, { frame: 9, value: 1, interp: 'linear' }] }] }] };
test('serialize → parse menghasilkan project yang sama', () => assert.deepEqual(parseProject(serializeProject(proj)), proj));
test('parse menolak yang bukan project', () => {
  assert.throws(() => parseProject('{bukan json'), /JSON/);
  assert.throws(() => parseProject('{"version":2,"motions":[]}'), /project/);
});
test('normalisasi: id ganda, keyframe rusak/duplikat, nilai invalid', () => {
  const p = normalizeProject({ version: 1, activeMotionId: 'zz', motions: [
    { id: 'x', fps: -1, totalFrames: 'abc', tracks: [{ paramId: 'P', keyframes: [{ frame: 5, value: 1 }, { frame: 5, value: 2 }, { frame: 'a', value: 0 }, { frame: 1, value: 0, interp: 'aneh' }] }, { paramId: 'Q', keyframes: [] }] },
    { id: 'x', name: 'B' }] });
  assert.equal(p.motions[1].id, 'x_'); assert.equal(p.activeMotionId, 'x');
  assert.equal(p.motions[0].fps, 30); assert.equal(p.motions[0].totalFrames, 150); assert.equal(p.motions[0].tracks.length, 1);
  assert.deepEqual(p.motions[0].tracks[0].keyframes.map(k => [k.frame, k.value, k.interp]), [[1, 0, 'linear'], [5, 2, 'linear']]);
});

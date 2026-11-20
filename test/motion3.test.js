import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMotion3, parseMotion3 } from '../js/io/motion3.js';
import { evalTrack } from '../js/motion/interp.js';
const mk = tracks => ({ fps: 30, totalFrames: 150, loop: true, tracks });
const sample = mk([
  { paramId: 'ParamAngleX', keyframes: [{ frame: 0, value: 0, interp: 'linear' }, { frame: 30, value: 15, interp: 'bezier', ease: 'inout', handles: { out: [10, 0], in: [-10, -15] } }, { frame: 60, value: -10, interp: 'stepped' }, { frame: 90, value: 5, interp: 'linear' }] },
  { paramId: 'ParamEyeLOpen', keyframes: [{ frame: 15, value: 1, interp: 'linear' }] },
]);
test('build: hitungan Meta dan kode segmen benar', () => {
  const j = buildMotion3(sample), c = j.Curves[0].Segments;
  assert.equal(j.Meta.CurveCount, 2); assert.equal(j.Meta.TotalSegmentCount, 3); assert.equal(j.Meta.TotalPointCount, 1 + 3 + 1 + 1 + 1);
  assert.equal(j.Meta.AreBeziersRestricted, true);
  // titik awal | linear(0) | bezier(1)+3 titik | stepped(2)
  assert.deepEqual(c.slice(0, 5), [0, 0, 0, 1, 15]); assert.equal(c[5], 1); assert.deepEqual(c.slice(10, 12), [2, -10]);
  assert.equal(c[12], 2); assert.equal(c.length, 15);
});
test('build: bezier handle thirds → Restricted true; non-thirds → false', () => {
  const thirds = mk([{ paramId: 'P', keyframes: [{ frame: 0, value: 0, interp: 'bezier', handles: { out: [10, 0], in: [-10, 0] } }, { frame: 30, value: 1, interp: 'linear' }] }]);
  assert.equal(buildMotion3(thirds).Meta.AreBeziersRestricted, true);
  thirds.tracks[0].keyframes[0].handles.out[0] = 5;
  assert.equal(buildMotion3(thirds).Meta.AreBeziersRestricted, false);
});
test('round-trip build → parse → build identik, nilai tiap keyframe sama', () => {
  const a = buildMotion3(sample), p = parseMotion3(a);
  assert.equal(p.warnings.length, 0); assert.equal(p.fps, 30); assert.equal(p.totalFrames, 150); assert.equal(p.loop, true);
  assert.deepEqual(buildMotion3({ ...p }), a);
  const orig = sample.tracks[0].keyframes, back = p.tracks[0].keyframes;
  for (const k of orig) assert.equal(evalTrack(back, k.frame), k.value);
  for (const f of [5, 15, 25, 45, 75]) assert.ok(Math.abs(evalTrack(back, f) - evalTrack(orig, f)) < 1e-3);
});
test('parse: peringatan untuk parameter asing, target non-Parameter, inverse-stepped', () => {
  const j = { Version: 3, Meta: { Fps: 30, Duration: 1, Loop: false }, Curves: [
    { Target: 'Parameter', Id: 'A', Segments: [0, 0, 3, 0.5, 1] }, { Target: 'Parameter', Id: 'X', Segments: [0, 0, 0, 1, 1] }, { Target: 'Model', Id: 'Opacity', Segments: [0, 1, 0, 1, 1] }] };
  const p = parseMotion3(j, { ids: new Set(['A']) });
  assert.equal(p.tracks.length, 1); assert.equal(p.warnings.length, 3); assert.equal(p.tracks[0].keyframes[0].interp, 'stepped');
  assert.equal(p.loop, false); assert.equal(p.totalFrames, 30);
});
test('parse: file rusak melempar error yang jelas', () => {
  assert.throws(() => parseMotion3({ Version: 2, Curves: [] }), /motion3/);
  assert.throws(() => parseMotion3({ Version: 3, Curves: [{ Target: 'Parameter', Id: 'A', Segments: [0, 0, 1, 1, 1] }] }), /rusak/);
  assert.throws(() => parseMotion3({ Version: 3, Curves: [{ Target: 'Parameter', Id: 'A', Segments: [0] }] }), /tidak valid/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { evalTrack, toggleKey, setMode, refreshEase, keyAt } from '../js/motion/interp.js';
const K = (frame, value, interp = 'linear') => ({ frame, value, interp });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);

test('linear, stepped, dan clamp di luar rentang', () => {
  const t = [K(0, 0), K(10, 10, 'stepped'), K(20, 0)];
  near(evalTrack(t, 5), 5); near(evalTrack(t, -3), 0); near(evalTrack(t, 99), 0);
  assert.equal(evalTrack([K(0, 1, 'stepped'), K(10, 9)], 9.9), 1);
  assert.equal(evalTrack([], 3), null);
});
test('ease inout: simetris, melambat di ujung, nilai ujung tepat', () => {
  const m = { tracks: [] }; toggleKey(m, 'P', 0, 0, 'inout'); toggleKey(m, 'P', 30, 1);
  const k = m.tracks[0].keyframes;
  assert.equal(k[0].interp, 'bezier'); near(evalTrack(k, 0), 0); near(evalTrack(k, 30), 1);
  near(evalTrack(k, 15), 0.5); assert.ok(evalTrack(k, 7.5) < 0.25 && evalTrack(k, 22.5) > 0.75);
});
test('bezier tanpa handles = linear; handle kustom dijepit agar monoton', () => {
  near(evalTrack([K(0, 0, 'bezier'), K(10, 10)], 4), 4);
  const a = { ...K(0, 0, 'bezier'), handles: { out: [50, 0], in: [-50, 0] } }, v = evalTrack([a, K(10, 1)], 5);
  assert.ok(v >= 0 && v <= 1);
});
test('toggleKey: tambah terurut, hapus, track kosong dibuang, ease dihitung ulang', () => {
  const m = { tracks: [] };
  toggleKey(m, 'P', 20, 2); toggleKey(m, 'P', 0, 0, 'out'); toggleKey(m, 'P', 10, 1);
  assert.deepEqual(m.tracks[0].keyframes.map(k => k.frame), [0, 10, 20]);
  near(m.tracks[0].keyframes[0].handles.out[0], 10 / 3);
  toggleKey(m, 'P', 10, 0); near(m.tracks[0].keyframes[0].handles.out[0], 20 / 3);
  toggleKey(m, 'P', 0, 0); toggleKey(m, 'P', 20, 0); assert.equal(m.tracks.length, 0);
});
test('setMode membersihkan handles; keyframe terakhir tak punya handles', () => {
  const k = { frame: 0, value: 0, interp: 'bezier', ease: 'in', handles: { out: [1, 1], in: [-1, -1] } };
  setMode(k, 'stepped'); assert.deepEqual(k, { frame: 0, value: 0, interp: 'stepped' });
  const t = { paramId: 'P', keyframes: [{ frame: 0, value: 0, interp: 'bezier', ease: 'inout' }] };
  refreshEase(t); assert.equal(t.keyframes[0].handles, undefined);
  assert.equal(keyAt({ tracks: [t] }, 'P', 0).frame, 0);
});

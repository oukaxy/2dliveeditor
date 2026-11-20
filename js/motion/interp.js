/** Fungsi murni: tanpa DOM. */
/** @typedef {'linear'|'stepped'|'bezier'} Interp */
/** @typedef {{frame:number,value:number,interp:Interp,ease?:'inout'|'in'|'out',handles?:{out:[number,number],in:[number,number]}}} Keyframe
 *  Handle bezier RELATIF: `out` terhadap keyframe ini, `in` terhadap keyframe berikutnya (titik kontrol 2 = next + in).
 *  `ease` = preset; handle-nya diturunkan ulang oleh refreshEase() saat tetangga/nilai berubah. */
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Titik kontrol absolut [[f,v] x4] segmen a→b. Waktu kontrol dijepit ke [a,b] agar kurva monoton. */
export function controlPoints(a, b) {
  const dx = (b.frame - a.frame) / 3, dv = (b.value - a.value) / 3;
  const h = a.handles || { out: [dx, dv], in: [-dx, -dv] };
  return [[a.frame, a.value], [clamp(a.frame + h.out[0], a.frame, b.frame), a.value + h.out[1]],
    [clamp(b.frame + h.in[0], a.frame, b.frame), b.value + h.in[1]], [b.frame, b.value]];
}
const bz = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };
function evalBezier(a, b, f) {
  const [p0, p1, p2, p3] = controlPoints(a, b); let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (bz(p0[0], p1[0], p2[0], p3[0], m) < f) lo = m; else hi = m; }
  return bz(p0[1], p1[1], p2[1], p3[1], (lo + hi) / 2);
}
export function evalTrack(kfs, f) {
  if (!kfs.length) return null;
  if (f <= kfs[0].frame) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (f >= last.frame) return last.value;
  let i = 0; while (kfs[i + 1].frame <= f) i++;
  const a = kfs[i], b = kfs[i + 1];
  if (a.interp === 'stepped') return a.value;
  if (a.interp === 'bezier') return evalBezier(a, b, f);
  return a.value + (b.value - a.value) * (f - a.frame) / (b.frame - a.frame);
}
export const getTrack = (m, id) => m.tracks.find(t => t.paramId === id);
export const keyAt = (m, id, frame) => getTrack(m, id)?.keyframes.find(k => k.frame === frame);

/** Preset ease: fraksi nilai titik kontrol 1 dan 2 (waktu kontrol selalu di 1/3 dan 2/3 → cocok dengan AreBeziersRestricted). */
export const EASE = { inout: [0, 1], in: [0, 2 / 3], out: [1 / 3, 1] };
export const MODES = ['linear', 'stepped', 'inout', 'in', 'out'];
export const modeOf = k => k.interp === 'bezier' ? (k.ease || 'bezier') : k.interp;
export function setMode(k, mode) {
  delete k.ease; delete k.handles;
  if (mode === 'linear' || mode === 'stepped') k.interp = mode; else { k.interp = 'bezier'; k.ease = mode; }
}
/** Turunkan ulang handle semua keyframe ber-preset pada track. */
export function refreshEase(t) {
  const k = t.keyframes;
  for (let i = 0; i < k.length; i++) {
    const a = k[i], b = k[i + 1], e = EASE[a.ease];
    if (a.interp !== 'bezier' || !e) continue;
    if (!b) { delete a.handles; continue; }
    const dx = b.frame - a.frame, dv = b.value - a.value;
    a.handles = { out: [dx / 3, dv * e[0]], in: [-dx / 3, dv * (e[1] - 1)] };
  }
}
/** Tambah keyframe (mode: linear|stepped|inout|in|out) bila belum ada di frame itu, hapus bila sudah ada. */
export function toggleKey(m, id, frame, value, mode = 'linear') {
  let t = getTrack(m, id);
  if (!t) { t = { paramId: id, keyframes: [] }; m.tracks.push(t); }
  const i = t.keyframes.findIndex(k => k.frame === frame);
  if (i >= 0) t.keyframes.splice(i, 1);
  else { const k = { frame, value, interp: 'linear' }; setMode(k, mode); t.keyframes.push(k); t.keyframes.sort((a, b) => a.frame - b.frame); }
  if (!t.keyframes.length) m.tracks.splice(m.tracks.indexOf(t), 1); else refreshEase(t);
}

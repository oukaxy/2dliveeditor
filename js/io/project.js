import { EASE } from '../motion/interp.js';
/** Serialisasi/validasi file project (.l2dproj.json). Murni: tanpa DOM. */
const fin = (x, d) => Number.isFinite(x) ? x : d;
const pair = a => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite);
export const serializeProject = p => JSON.stringify(p, null, 2);

/** Validasi + normalisasi objek mentah menjadi Project. Melempar Error bila bukan project v1. */
export function normalizeProject(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.motions)) throw new Error('Bukan file project yang valid (butuh version 1 dan motions)');
  const seen = new Set();
  const motions = raw.motions.filter(m => m && typeof m === 'object').map((m, i) => {
    let id = typeof m.id === 'string' && m.id ? m.id : 'm' + (i + 1); while (seen.has(id)) id += '_'; seen.add(id);
    const tracks = (Array.isArray(m.tracks) ? m.tracks : []).filter(t => t && typeof t.paramId === 'string').map(t => {
      const byFrame = new Map();
      for (const k of Array.isArray(t.keyframes) ? t.keyframes : []) {
        if (!k || !Number.isFinite(k.frame) || !Number.isFinite(k.value)) continue;
        const nk = { frame: k.frame, value: k.value, interp: ['linear', 'stepped', 'bezier'].includes(k.interp) ? k.interp : 'linear' };
        if (nk.interp === 'bezier') {
          if (EASE[k.ease]) nk.ease = k.ease;
          if (k.handles && pair(k.handles.out) && pair(k.handles.in)) nk.handles = { out: [...k.handles.out], in: [...k.handles.in] };
        }
        byFrame.set(nk.frame, nk);
      }
      return { paramId: t.paramId, keyframes: [...byFrame.values()].sort((a, b) => a.frame - b.frame) };
    }).filter(t => t.keyframes.length);
    return { id, name: typeof m.name === 'string' && m.name ? m.name : 'Motion ' + (i + 1), fps: fin(m.fps, 30) > 0 ? fin(m.fps, 30) : 30,
      totalFrames: Math.max(1, Math.round(fin(m.totalFrames, 150))), loop: m.loop !== false, tracks };
  });
  return { version: 1, modelName: typeof raw.modelName === 'string' ? raw.modelName : '', motions,
    activeMotionId: motions.some(m => m.id === raw.activeMotionId) ? raw.activeMotionId : motions[0]?.id ?? null };
}
export function parseProject(text) {
  let raw; try { raw = JSON.parse(text); } catch { throw new Error('File project bukan JSON yang valid'); }
  return normalizeProject(raw);
}

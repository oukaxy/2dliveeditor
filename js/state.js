import { createHistory } from './motion/history.js';
/** @typedef {{frame:number,value:number,interp:'linear'|'stepped'|'bezier',ease?:string,handles?:object}} Keyframe */
/** @typedef {{id:string,name:string,fps:number,totalFrames:number,loop:boolean,tracks:{paramId:string,keyframes:Keyframe[]}[]}} Motion */
const ls = new Set();
export const history = createHistory(50);
export const state = { model: null, params: [], values: {}, frame: 0, playing: false, ppf: 8, filter: 'All', q: '', sel: null, newMode: 'linear',
  project: { version: 1, modelName: '', motions: [], activeMotionId: null } };
export const subscribe = f => (ls.add(f), () => ls.delete(f));
const snap = () => JSON.stringify(state.project);
/** Aksi → state → render. Dengan `tag`, perubahan pada project dicatat untuk undo; `merge` menggabungkan perubahan beruntun bertag sama (drag slider). */
export const dispatch = (fn, tag, merge) => {
  const before = tag ? snap() : null;
  fn(state);
  if (tag) { const after = snap(); if (after !== before) history.record(before, tag, merge); }
  ls.forEach(f => f(state));
};
export const active = () => state.project.motions.find(m => m.id === state.project.activeMotionId);
export function newMotion(name) {
  const ms = state.project.motions; let n = ms.length + 1;
  const m = { id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), name: name || 'Motion ' + n, fps: 30, totalFrames: 150, loop: true, tracks: [] };
  ms.push(m); state.project.activeMotionId = m.id; return m;
}
function fixup(s) {
  const ms = s.project.motions;
  if (!ms.length) newMotion(); else if (!ms.some(m => m.id === s.project.activeMotionId)) s.project.activeMotionId = ms[0].id;
  s.frame = Math.min(s.frame, active().totalFrames); s.sel = null;
}
/** Ganti seluruh project (muat file / pulihkan autosave); riwayat undo dikosongkan. */
export function loadProject(p) { history.clear(); dispatch(s => { s.project = p; s.frame = 0; fixup(s); }); }
const step = fn => {
  const p = fn(snap()); if (p == null) return false;
  dispatch(s => { const mn = s.project.modelName; s.project = JSON.parse(p); s.project.modelName = mn; fixup(s); }); return true;
};
export const undo = () => step(c => history.undo(c));
export const redo = () => step(c => history.redo(c));

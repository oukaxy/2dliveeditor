/* Live2D Motion Editor — satu file. Urutan bagian: history, interp, motion3, project, storage, state, params, loader, UI. */

/* ===== motion/history ===== */
/** Riwayat undo/redo berbasis snapshot string. Murni: tanpa DOM. */
function createHistory(limit = 50, now = Date.now) {
  let past = [], future = [], lastTag = null, lastAt = 0;
  return {
    /** Catat snapshot SEBELUM perubahan. `merge`: gabung dengan catatan sebelumnya bila tag sama dan masih berurutan (drag slider). */
    record(snapshot, tag, merge = false) {
      const t = now(), merged = merge && tag === lastTag && t - lastAt < 800;
      lastTag = tag; lastAt = t; future = [];
      if (merged) return;
      past.push(snapshot); if (past.length > limit) past.shift();
    },
    undo(current) { if (!past.length) return null; future.push(current); lastTag = null; return past.pop(); },
    redo(current) { if (!future.length) return null; past.push(current); if (past.length > limit) past.shift(); lastTag = null; return future.pop(); },
    clear() { past = []; future = []; lastTag = null; },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}

/* ===== motion/interp ===== */
/** Fungsi murni: tanpa DOM. */
/** @typedef {'linear'|'stepped'|'bezier'} Interp */
/** @typedef {{frame:number,value:number,interp:Interp,ease?:'inout'|'in'|'out',handles?:{out:[number,number],in:[number,number]}}} Keyframe
 *  Handle bezier RELATIF: `out` terhadap keyframe ini, `in` terhadap keyframe berikutnya (titik kontrol 2 = next + in).
 *  `ease` = preset; handle-nya diturunkan ulang oleh refreshEase() saat tetangga/nilai berubah. */
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Titik kontrol absolut [[f,v] x4] segmen a→b. Waktu kontrol dijepit ke [a,b] agar kurva monoton. */
function controlPoints(a, b) {
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
function evalTrack(kfs, f) {
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
const getTrack = (m, id) => m.tracks.find(t => t.paramId === id);
const keyAt = (m, id, frame) => getTrack(m, id)?.keyframes.find(k => k.frame === frame);

/** Preset ease: fraksi nilai titik kontrol 1 dan 2 (waktu kontrol selalu di 1/3 dan 2/3 → cocok dengan AreBeziersRestricted). */
const EASE = { inout: [0, 1], in: [0, 2 / 3], out: [1 / 3, 1] };
const MODES = ['linear', 'stepped', 'inout', 'in', 'out'];
const modeOf = k => k.interp === 'bezier' ? (k.ease || 'bezier') : k.interp;
function setMode(k, mode) {
  delete k.ease; delete k.handles;
  if (mode === 'linear' || mode === 'stepped') k.interp = mode; else { k.interp = 'bezier'; k.ease = mode; }
}
/** Turunkan ulang handle semua keyframe ber-preset pada track. */
function refreshEase(t) {
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
function toggleKey(m, id, frame, value, mode = 'linear') {
  let t = getTrack(m, id);
  if (!t) { t = { paramId: id, keyframes: [] }; m.tracks.push(t); }
  const i = t.keyframes.findIndex(k => k.frame === frame);
  if (i >= 0) t.keyframes.splice(i, 1);
  else { const k = { frame, value, interp: 'linear' }; setMode(k, mode); t.keyframes.push(k); t.keyframes.sort((a, b) => a.frame - b.frame); }
  if (!t.keyframes.length) m.tracks.splice(m.tracks.indexOf(t), 1); else refreshEase(t);
}

/* ===== io/motion3 ===== */
const r = n => Math.round(n * 1e4) / 1e4;
/** Bangun .motion3.json (linear=0, bezier=1, stepped=2). Fungsi murni. */
function buildMotion3(m) {
  const Curves = []; let seg = 0, pts = 0, restricted = true;
  for (const t of m.tracks) {
    const k = t.keyframes; if (!k.length) continue;
    const s = [r(k[0].frame / m.fps), r(k[0].value)]; pts++;
    for (let i = 1; i < k.length; i++) {
      const a = k[i - 1], b = k[i];
      if (a.interp === 'bezier') {
        const [, c1, c2] = controlPoints(a, b), dx = (b.frame - a.frame) / 3;
        if (Math.abs(c1[0] - (a.frame + dx)) > 1e-3 || Math.abs(c2[0] - (b.frame - dx)) > 1e-3) restricted = false;
        s.push(1, r(c1[0] / m.fps), r(c1[1]), r(c2[0] / m.fps), r(c2[1]), r(b.frame / m.fps), r(b.value)); pts += 3;
      } else { s.push(a.interp === 'stepped' ? 2 : 0, r(b.frame / m.fps), r(b.value)); pts++; }
      seg++;
    }
    Curves.push({ Target: 'Parameter', Id: t.paramId, Segments: s });
  }
  return { Version: 3, Meta: { Duration: r(m.totalFrames / m.fps), Fps: m.fps, Loop: m.loop, AreBeziersRestricted: restricted,
    CurveCount: Curves.length, TotalSegmentCount: seg, TotalPointCount: pts, UserDataCount: 0, TotalUserDataSize: 0 }, Curves };
}

/**
 * Parse .motion3.json → {fps,totalFrames,loop,tracks,warnings}. Murni.
 * `ids` (Set, opsional): parameter yang ada di model; kurva lain dilewati dengan peringatan.
 * Melempar Error untuk file yang rusak.
 */
function parseMotion3(json, { ids } = {}) {
  if (!json || json.Version !== 3 || !Array.isArray(json.Curves)) throw new Error('Bukan file .motion3.json yang valid (butuh Version 3 dan Curves)');
  const meta = json.Meta || {}, fps = meta.Fps > 0 ? meta.Fps : 30, warnings = [], tracks = [];
  const F = t => { const f = t * fps, n = Math.round(f); return Math.abs(f - n) < 0.01 ? n : Math.round(f * 1e3) / 1e3; };
  const q = x => Math.round(x * 1e4) / 1e4;
  let maxF = 0;
  for (const c of json.Curves) {
    if (c.Target !== 'Parameter') { warnings.push(`Kurva ${c.Target}:${c.Id} dilewati (hanya Parameter yang didukung)`); continue; }
    if (ids && !ids.has(c.Id)) { warnings.push(`Parameter "${c.Id}" tidak ada di model, dilewati`); continue; }
    const s = c.Segments;
    if (!Array.isArray(s) || s.length < 2 || s.some(x => typeof x !== 'number' || !isFinite(x))) throw new Error(`Segments kurva "${c.Id}" tidak valid`);
    const kfs = [{ frame: F(s[0]), value: s[1], interp: 'linear' }];
    for (let i = 2; i < s.length;) {
      const type = s[i], n = type === 1 ? 7 : 3, prev = kfs[kfs.length - 1];
      if (![0, 1, 2, 3].includes(type) || i + n > s.length) throw new Error(`Segments kurva "${c.Id}" rusak di indeks ${i}`);
      const key = { frame: F(s[i + n - 2]), value: s[i + n - 1], interp: 'linear' };
      if (key.frame <= prev.frame) { warnings.push(`"${c.Id}": segmen dengan waktu tidak naik dilewati`); i += n; continue; }
      if (type === 1) { prev.interp = 'bezier'; prev.handles = { out: [q(s[i + 1] * fps - prev.frame), q(s[i + 2] - prev.value)], in: [q(s[i + 3] * fps - key.frame), q(s[i + 4] - key.value)] }; }
      else { prev.interp = type === 0 ? 'linear' : 'stepped'; if (type === 3) warnings.push(`"${c.Id}": inverse-stepped diubah jadi stepped`); }
      kfs.push(key); i += n;
    }
    maxF = Math.max(maxF, kfs[kfs.length - 1].frame);
    tracks.push({ paramId: c.Id, keyframes: kfs });
  }
  const dur = Number.isFinite(meta.Duration) ? Math.round(meta.Duration * fps) : 0;
  return { fps, totalFrames: Math.max(1, dur, Math.ceil(maxF)), loop: !!meta.Loop, tracks, warnings };
}

/* ===== io/project ===== */
/** Serialisasi/validasi file project (.l2dproj.json). Murni: tanpa DOM. */
const fin = (x, d) => Number.isFinite(x) ? x : d;
const pair = a => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite);
const serializeProject = p => JSON.stringify(p, null, 2);

/** Validasi + normalisasi objek mentah menjadi Project. Melempar Error bila bukan project v1. */
function normalizeProject(raw) {
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
function parseProject(text) {
  let raw; try { raw = JSON.parse(text); } catch { throw new Error('File project bukan JSON yang valid'); }
  return normalizeProject(raw);
}

/* ===== io/storage ===== */
/** Pembungkus kecil IndexedDB untuk autosave. Semua fungsi mengembalikan Promise dan bisa reject (mis. mode privat). */
const DB = 'l2d-motion-editor', ST = 'projects';
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(ST);
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const db = await open();
  try { return await new Promise((res, rej) => { const t = db.transaction(ST, mode), rq = fn(t.objectStore(ST)); t.oncomplete = () => res(rq.result); t.onerror = t.onabort = () => rej(t.error); }); }
  finally { db.close(); }
}
const saveAuto = (key, value) => tx('readwrite', s => s.put(value, key));
const loadAuto = key => tx('readonly', s => s.get(key));
const clearAuto = key => tx('readwrite', s => s.delete(key));

/* ===== state ===== */
/** @typedef {{frame:number,value:number,interp:'linear'|'stepped'|'bezier',ease?:string,handles?:object}} Keyframe */
/** @typedef {{id:string,name:string,fps:number,totalFrames:number,loop:boolean,tracks:{paramId:string,keyframes:Keyframe[]}[]}} Motion */
const ls = new Set();
const history = createHistory(50);
const state = { model: null, params: [], values: {}, frame: 0, playing: false, ppf: 8, filter: 'All', q: '', sel: null, newMode: 'linear',
  project: { version: 1, modelName: '', motions: [], activeMotionId: null } };
const subscribe = f => (ls.add(f), () => ls.delete(f));
const snap = () => JSON.stringify(state.project);
/** Aksi → state → render. Dengan `tag`, perubahan pada project dicatat untuk undo; `merge` menggabungkan perubahan beruntun bertag sama (drag slider). */
const dispatch = (fn, tag, merge) => {
  const before = tag ? snap() : null;
  fn(state);
  if (tag) { const after = snap(); if (after !== before) history.record(before, tag, merge); }
  ls.forEach(f => f(state));
};
const active = () => state.project.motions.find(m => m.id === state.project.activeMotionId);
function newMotion(name) {
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
function loadProject(p) { history.clear(); dispatch(s => { s.project = p; s.frame = 0; fixup(s); }); }
const step = fn => {
  const p = fn(snap()); if (p == null) return false;
  dispatch(s => { const mn = s.project.modelName; s.project = JSON.parse(p); s.project.modelName = mn; fixup(s); }); return true;
};
const undo = () => step(c => history.undo(c));
const redo = () => step(c => history.redo(c));

/* ===== model/params ===== */
/** Mengenali ID gaya Cubism 3+ (ParamAngleX) maupun gaya lama (PARAM_ANGLE_X). */
function categoryOf(id) {
  const n = id.replace(/_/g, '').toLowerCase();
  if (/^paramangle/.test(n)) return 'Head';
  if (/^parameye/.test(n)) return 'Eyes';
  if (/^param(brow|mouth|cheek)/.test(n)) return 'Face';
  if (/^param(body|breath)/.test(n)) return 'Body';
  if (/^param(arm|hand)/.test(n)) return 'Arms';
  return 'Other';
}
function readParams(model) {
  const p = model.internalModel.coreModel._model.parameters, out = [];
  for (let i = 0; i < p.count; i++) out.push({ id: p.ids[i], min: p.minimumValues[i], max: p.maximumValues[i], def: p.defaultValues[i], cat: categoryOf(p.ids[i]) });
  return out;
}

/* ===== model/loader ===== */
/** Baca file/zip, petakan path relatif ke blob URL, lalu muat model Cubism 3+. */
async function loadModelFiles(fileList) {
  const map = new Map();
  for (const f of [...fileList]) {
    if (/\.zip$/i.test(f.name)) {
      const u = fflate.unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [p, d] of Object.entries(u)) if (!p.endsWith('/')) map.set(p, new Blob([d]));
    } else map.set(f.webkitRelativePath || f.name, f);
  }
  const jp = [...map.keys()].find(p => /\.model3\.json$/i.test(p));
  if (!jp) throw new Error('File *.model3.json tidak ditemukan. Model Cubism 2 tidak didukung.');
  const dir = jp.includes('/') ? jp.slice(0, jp.lastIndexOf('/') + 1) : '';
  const cache = new Map(), names = new Map(); // names: blob URL → path di zip, untuk pesan error
  const url = (rel, required) => {
    const path = decodeURIComponent(new URL(rel, 'http://x/' + dir).pathname.slice(1));
    const base = path.split('/').pop();
    const key = map.has(path) ? path : [...map.keys()].find(k => k.split('/').pop() === base);
    if (!key) { if (required) throw new Error(`File "${rel}" tidak ada di pilihan file`); return undefined; }
    if (!cache.has(key)) { const u = URL.createObjectURL(map.get(key)); cache.set(key, u); names.set(u, key); }
    return cache.get(key);
  };
  const json = JSON.parse(await map.get(jp).text()), fr = json.FileReferences;
  if (!fr?.Moc) throw new Error('model3.json tidak valid: FileReferences.Moc kosong');
  fr.Moc = url(fr.Moc, true);
  fr.Textures = (fr.Textures || []).map(t => url(t, true));
  for (const k of ['Physics', 'Pose', 'DisplayInfo', 'UserData']) if (fr[k]) { fr[k] = url(fr[k]); if (!fr[k]) delete fr[k]; }
  if (fr.Expressions) fr.Expressions = fr.Expressions.map(e => ({ ...e, File: url(e.File) })).filter(e => e.File);
  if (fr.Motions) for (const g in fr.Motions) fr.Motions[g] = fr.Motions[g].map(m => ({ ...m, File: url(m.File) })).filter(m => m.File);
  // Semua path di FileReferences sudah berupa blob URL absolut. `url.resolve` milik Pixi merusaknya
  // (jadi "blob:https//…" → Network error), jadi resolveURL diganti agar meneruskan path apa adanya.
  const S = PIXI.live2d.Cubism4ModelSettings;
  if (!S) throw new Error('Cubism4ModelSettings tidak tersedia di build pixi-live2d-display ini');
  const settings = new S({ ...json, url: 'model/' + jp.split('/').pop() });
  settings.resolveURL = p => p;
  let model;
  try { model = await PIXI.live2d.Live2DModel.from(settings, { autoInteract: false, motionPreload: PIXI.live2d.MotionPreloadStrategy?.NONE }); }
  catch (e) {
    const f = names.get(e?.url);
    throw new Error(f ? `Gagal membaca "${f}" (${e.message || 'error'})` : `Gagal memuat model: ${e?.message || e}${e?.url ? ' [' + String(e.url).slice(0, 90) + ']' : ''}`);
  }
  return { model, name: jp.split('/').pop().replace(/\.model3\.json$/i, '') };
}

/* ===== main ===== */
const $ = s => document.querySelector(s);
let modelName = '', armed = false;
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
let tt; const toast = (msg, err) => { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(() => t.className = '', 3500); };
const cur = p => state.values[p.id] ?? p.def;
const fmt = n => (Math.round(n * 100) / 100).toString();

/* ---------- Pixi ---------- */
const app = new PIXI.Application({ view: $('#cv'), resizeTo: $('#stage'), backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker);
setInterval(() => $('#fps').textContent = Math.round(app.ticker.FPS) + ' fps', 500);
function fit() { const m = state.model; if (!m) return; m.scale.set(1); const s = Math.min(app.screen.width / m.width, app.screen.height / m.height) * .95; m.scale.set(s); m.anchor.set(.5); m.position.set(app.screen.width / 2, app.screen.height / 2); }
app.renderer.on('resize', () => { fit(); applyView(); });
new ResizeObserver(() => app.resize?.()).observe($('#stage')); // ikut berubah saat tinggi preview diubah / bar browser naik-turun
$('#bSize').onclick = () => { const mn = $('main'); mn.style.removeProperty('--sh'); const c = mn.classList.toggle('compact'); $('#bSize').textContent = c ? '⤢' : '⤡'; };
/* splitter: tarik garis untuk mengubah tinggi preview (diingat lewat localStorage) */
(() => {
  const mn = $('main'), sp = $('#split'), stg = $('#stage');
  const setH = px => { px = Math.max(innerHeight * .12, Math.min(innerHeight * .68, px)); mn.classList.remove('compact'); $('#bSize').textContent = '⤡'; mn.style.setProperty('--sh', px + 'px'); };
  const save = () => { try { localStorage.setItem('previewH', Math.round(stg.getBoundingClientRect().height)); } catch {} };
  try { const s = +localStorage.getItem('previewH'); if (s) setH(s); } catch {}
  let y0 = null, h0 = 0;
  sp.addEventListener('pointerdown', e => { sp.setPointerCapture(e.pointerId); y0 = e.clientY; h0 = stg.getBoundingClientRect().height; mn.classList.add('dragging'); });
  sp.addEventListener('pointermove', e => { if (y0 != null) setH(h0 + e.clientY - y0); });
  const end = () => { if (y0 == null) return; y0 = null; mn.classList.remove('dragging'); save(); };
  sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
  sp.addEventListener('keydown', e => { if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault(); setH(stg.getBoundingClientRect().height + (e.key === 'ArrowDown' ? 24 : -24)); save(); });
})();

/* ---------- Zoom & pan preview (pinch, geser, double-tap, scroll) ---------- */
const view = { z: 1, ox: 0, oy: 0 }; // ox/oy = geseran sebagai pecahan lebar/tinggi preview, relatif terhadap fit()
const ZMIN = .5, ZMAX = 8;
function applyView() {
  const W = app.screen.width, H = app.screen.height, z = view.z;
  app.stage.scale.set(z);
  app.stage.position.set(W / 2 * (1 - z) + view.ox * W, H / 2 * (1 - z) + view.oy * H);
  const idle = Math.abs(z - 1) < .01 && Math.abs(view.ox) < .005 && Math.abs(view.oy) < .005;
  const b = $('#bReset'); b.hidden = idle; if (!idle) b.textContent = 'Reset · ' + (Math.round(z * 10) / 10) + '×';
}
// hitung view baru bila zoom ke nz dengan titik (fx,fy) (px di dalam preview) tetap diam
function zoomTarget(fx, fy, nz) {
  const W = app.screen.width, H = app.screen.height, z = view.z;
  nz = Math.max(ZMIN, Math.min(ZMAX, nz));
  const Px = W / 2 * (1 - z) + view.ox * W, Py = H / 2 * (1 - z) + view.oy * H, k = nz / z;
  const nPx = fx - k * (fx - Px), nPy = fy - k * (fy - Py);
  return { z: nz, ox: (nPx - W / 2 * (1 - nz)) / W, oy: (nPy - H / 2 * (1 - nz)) / H };
}
const setView = v => { view.z = v.z; view.ox = v.ox; view.oy = v.oy; applyView(); };
let vAnim;
function animateView(to) {
  cancelAnimationFrame(vAnim); const from = { ...view }, t0 = performance.now(), D = 160;
  const step = now => {
    const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
    setView({ z: from.z + (to.z - from.z) * e, ox: from.ox + (to.ox - from.ox) * e, oy: from.oy + (to.oy - from.oy) * e });
    if (p < 1) vAnim = requestAnimationFrame(step);
  };
  vAnim = requestAnimationFrame(step);
}
function resetView() { cancelAnimationFrame(vAnim); setView({ z: 1, ox: 0, oy: 0 }); }
$('#bReset').onclick = () => animateView({ z: 1, ox: 0, oy: 0 });
(() => {
  const stg = $('#stage'), ptrs = new Map();
  let multi = false, moved = 0, tdown = 0, lastTap = { t: 0, x: 0, y: 0 };
  const local = e => { const r = stg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const skip = e => !state.model || e.target.closest('#split,#bSize,#bReset,#drop');
  stg.addEventListener('pointerdown', e => {
    if (skip(e)) return;
    cancelAnimationFrame(vAnim);
    stg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, local(e));
    if (ptrs.size === 1) { multi = false; moved = 0; tdown = performance.now(); } else multi = true;
  });
  stg.addEventListener('pointermove', e => {
    const old = ptrs.get(e.pointerId); if (!old) return;
    const nw = local(e), W = app.screen.width, H = app.screen.height;
    if (ptrs.size === 1) {
      moved += Math.hypot(nw.x - old.x, nw.y - old.y);
      view.ox += (nw.x - old.x) / W; view.oy += (nw.y - old.y) / H; applyView();
    } else if (ptrs.size === 2) {
      const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1];
      const d0 = Math.hypot(old.x - other.x, old.y - other.y) || 1, d1 = Math.hypot(nw.x - other.x, nw.y - other.y) || 1;
      const c0 = { x: (old.x + other.x) / 2, y: (old.y + other.y) / 2 }, c1 = { x: (nw.x + other.x) / 2, y: (nw.y + other.y) / 2 };
      const t = zoomTarget(c0.x, c0.y, view.z * d1 / d0);
      view.z = t.z; view.ox = t.ox + (c1.x - c0.x) / W; view.oy = t.oy + (c1.y - c0.y) / H; applyView();
    }
    ptrs.set(e.pointerId, nw);
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
    if (ptrs.size) return;
    // tap tunggal (tanpa geser) → cek double-tap
    if (!multi && e.type === 'pointerup' && moved < 10 && performance.now() - tdown < 350) {
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
        lastTap.t = 0;
        animateView(view.z > 1.2 ? { z: 1, ox: 0, oy: 0 } : zoomTarget(p.x, p.y, 2.5));
      } else lastTap = { t: now, x: p.x, y: p.y };
    }
  };
  stg.addEventListener('pointerup', up); stg.addEventListener('pointercancel', up);
  stg.addEventListener('wheel', e => {
    if (!state.model) return; e.preventDefault(); cancelAnimationFrame(vAnim);
    const p = local(e); setView(zoomTarget(p.x, p.y, view.z * Math.exp(-e.deltaY * .0015)));
  }, { passive: false });
  stg.addEventListener('dblclick', e => e.preventDefault());
})();

async function openFiles(files) {
  $('#status').textContent = 'Memuat…';
  try {
    const { model, name } = await loadModelFiles(files);
    unload();
    const im = model.internalModel;
    im.motionManager.stopAllMotions?.(); im.eyeBlink = undefined; im.breath = undefined; im.physics = undefined;
    im.on('beforeModelUpdate', () => { const cm = im.coreModel; for (const id in state.values) cm.setParameterValueById(id, state.values[id]); });
    app.stage.addChild(model);
    modelName = name;
    dispatch(s => { s.model = model; s.params = readParams(model); s.values = {}; s.project.modelName = name; });
    fit(); $('#drop').classList.add('hide'); toast('Model siap: ' + name);
    await offerRestore(name);
  } catch (e) { console.error(e); $('#status').textContent = 'Belum dimuat'; toast(e.message || 'Gagal memuat model', true); }
}
function unload() { resetView(); if (state.model) { app.stage.removeChild(state.model); state.model.destroy(); } stop(); dispatch(s => { s.model = null; s.params = []; s.values = {}; }); $('#drop').classList.remove('hide'); }
$('#bOpen').onclick = $('#bPick').onclick = () => $('#file').click();
$('#file').onchange = e => { if (e.target.files.length) openFiles(e.target.files); e.target.value = ''; };
$('#bUnload').onclick = unload;
const st = $('#stage');
st.ondragover = e => { e.preventDefault(); $('#drop').classList.add('over'); };
st.ondragleave = () => $('#drop').classList.remove('over');
st.ondrop = e => { e.preventDefault(); $('#drop').classList.remove('over'); if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files); };

/* ---------- Playback ---------- */
let raf, t0, f0;
const evalAt = f => { const m = active(); if (!m) return; for (const t of m.tracks) { const v = evalTrack(t.keyframes, f); if (v != null) state.values[t.paramId] = v; } };
function setFrame(f) { state.frame = f; evalAt(f); paintTransport(); syncParams(); paintHead(); }
function play() { const m = active(); if (!m) return; if (state.frame >= m.totalFrames) state.frame = 0; f0 = state.frame; t0 = performance.now(); dispatch(s => s.playing = true); loop(); }
function stop() { cancelAnimationFrame(raf); if (state.playing) dispatch(s => s.playing = false); }
function loop() {
  if (!state.playing) return; const m = active();
  let f = f0 + (performance.now() - t0) / 1000 * m.fps;
  if (f >= m.totalFrames) { if (m.loop) { f %= m.totalFrames; f0 = f; t0 = performance.now(); } else { f = m.totalFrames; setFrame(f); return stop(); } }
  setFrame(f); raf = requestAnimationFrame(loop);
}
$('#bPlay').onclick = () => state.playing ? stop() : play();
$('#bPrev').onclick = () => { stop(); setFrame(0); play(); };
$('#cLoop').onchange = e => dispatch(() => active().loop = e.target.checked, 'loop');
$('#scrub').oninput = e => { stop(); setFrame(+e.target.value); };
$('#dur').onchange = e => dispatch(() => { const m = active(); m.totalFrames = Math.max(1, Math.round(+e.target.value) || 150); state.frame = Math.min(state.frame, m.totalFrames); }, 'dur');

function paintTransport() {
  const m = active(); if (!m) return;
  const tc = f => { const s = f / m.fps, ff = Math.floor(f % m.fps); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0') + ':' + String(ff).padStart(2, '0'); };
  $('#tc').textContent = tc(state.frame) + ' / ' + tc(m.totalFrames);
  $('#scrub').max = m.totalFrames; $('#scrub').value = state.frame;
}
function paintHead() { const h = document.querySelector('.ph'); if (h) h.style.left = state.frame * state.ppf + 'px'; }

/* ---------- Parameter ---------- */
const CATS = ['All', 'Head', 'Face', 'Eyes', 'Body', 'Arms'];
function renderChips() {
  const c = $('#chips'); c.replaceChildren(...CATS.map(n => { const b = el('button', n === state.filter ? 'on' : '', n); b.onclick = () => { state.filter = n; renderChips(); renderParams(); }; return b; }));
}
function renderParams() {
  const L = $('#plist'); if (!state.params.length) { L.replaceChildren(el('p', 'empty', 'Muat model untuk melihat parameter.')); return; }
  const q = state.q.toLowerCase();
  const rows = state.params.filter(p => (state.filter === 'All' || p.cat === state.filter) && p.id.toLowerCase().includes(q)).map(p => {
    const r = el('div', 'row'); r.dataset.id = p.id;
    const lb = el('label', '', p.id), out = el('output'), kf = el('button', 'kf', '◆'); kf.title = 'Keyframe di playhead';
    const sl = el('input'); sl.type = 'range'; sl.min = p.min; sl.max = p.max; sl.step = (p.max - p.min) / 200; sl.setAttribute('aria-label', p.id);
    sl.oninput = () => { stop(); dispatch(() => { state.values[p.id] = +sl.value; const m = active(), k = m && keyAt(m, p.id, Math.round(state.frame)); if (k) { k.value = +sl.value; refreshEase(getTrack(m, p.id)); } }, 'val:' + p.id, true); };
    kf.onclick = () => { stop(); const f = Math.round(state.frame); dispatch(() => { const m = active(); toggleKey(m, p.id, f, cur(p), state.newMode); state.frame = f; }, 'kf'); };
    r.append(lb, out, sl, kf); return r;
  });
  L.replaceChildren(...(rows.length ? rows : [el('p', 'empty', 'Tidak ada parameter yang cocok.')]));
  syncParams();
}
function syncParams() {
  const m = active(), f = Math.round(state.frame);
  for (const r of document.querySelectorAll('.row')) {
    const p = state.params.find(x => x.id === r.dataset.id); if (!p) continue;
    const v = cur(p); r.querySelector('input').value = v; r.querySelector('output').textContent = fmt(v);
    r.querySelector('.kf').classList.toggle('on', !!(m && keyAt(m, p.id, f)));
  }
}
$('#q').oninput = e => { state.q = e.target.value; renderParams(); };

/* ---------- Timeline ---------- */
function renderTimeline() {
  const m = active(), box = $('#tl'); if (!m) return;
  const W = m.totalFrames * state.ppf + 8, w = el('div', 'tlw'); w.style.width = W + 'px';
  const ru = el('div', 'ruler'); const step = state.ppf < 6 ? 30 : 15;
  for (let f = 0; f <= m.totalFrames; f += step) { const t = el('i', '', f); t.style.left = f * state.ppf + 'px'; ru.append(t); }
  const seek = e => { stop(); const x = e.clientX - ru.getBoundingClientRect().left; setFrame(Math.max(0, Math.min(m.totalFrames, x / state.ppf))); };
  ru.onpointerdown = e => { ru.setPointerCapture(e.pointerId); seek(e); ru.onpointermove = seek; };
  ru.onpointerup = () => ru.onpointermove = null;
  w.append(ru);
  if (!m.tracks.length) w.append(el('p', 'empty', 'Belum ada keyframe. Ketuk ◆ pada sebuah parameter.'));
  for (const t of m.tracks) {
    const row = el('div', 'trk'); row.append(el('span', 'lab', t.paramId));
    for (const k of t.keyframes) {
      const b = el('button', 'k' + (k.interp === 'stepped' ? ' st' : k.interp === 'bezier' ? ' bz' : '') + (state.sel === t.paramId + ':' + k.frame ? ' sel' : '')); b.style.left = k.frame * state.ppf + 'px';
      b.title = `${t.paramId} @${k.frame} = ${fmt(k.value)} (${modeOf(k)})`;
      b.onclick = () => { stop(); state.sel = t.paramId + ':' + k.frame; dispatch(() => state.frame = k.frame); setFrame(k.frame); };
      b.ondblclick = () => dispatch(() => { setMode(k, MODES[(MODES.indexOf(modeOf(k)) + 1) % MODES.length]); refreshEase(t); }, 'interp');
      row.append(b);
    }
    w.append(row);
  }
  w.append(el('div', 'ph')); box.replaceChildren(w); paintHead();
}
$('#zIn').onclick = () => dispatch(s => s.ppf = Math.min(40, s.ppf * 1.5));
$('#zOut').onclick = () => dispatch(s => s.ppf = Math.max(2, s.ppf / 1.5));

/* ---------- Motion ---------- */
function renderMotions() {
  const L = $('#mlist'); L.replaceChildren(...state.project.motions.map(m => {
    const d = el('div', 'mi' + (m.id === state.project.activeMotionId ? ' on' : ''), m.name);
    d.append(el('span', '', (m.totalFrames / m.fps).toFixed(1) + ' dtk' + (m.loop ? ' · loop' : '')));
    d.onclick = () => { stop(); dispatch(s => { s.project.activeMotionId = m.id; s.frame = 0; s.sel = null; }); evalAt(0); }; return d;
  }));
}
$('#mNew').onclick = () => { stop(); dispatch(s => { newMotion(); s.frame = 0; }, 'motion'); };
$('#mRen').onclick = () => { const m = active(), n = prompt('Nama motion', m?.name); if (n?.trim()) dispatch(() => m.name = n.trim(), 'motion'); };
$('#mDup').onclick = () => { const m = active(); if (!m) return; dispatch(s => { const c = newMotion(m.name + ' copy'); Object.assign(c, JSON.parse(JSON.stringify({ ...m, id: c.id, name: c.name }))); }, 'motion'); };
$('#mDel').onclick = () => { const m = active(); if (!m || !confirm(`Hapus "${m.name}"?`)) return; stop(); dispatch(s => { const ms = s.project.motions; ms.splice(ms.indexOf(m), 1); if (!ms.length) newMotion(); else s.project.activeMotionId = ms[0].id; s.frame = 0; }, 'motion'); };

/* ---------- Export ---------- */
let out = '';
$('#bExport').onclick = () => {
  const m = active(); if (!m || !m.tracks.length) return toast('Tambahkan minimal satu keyframe dulu', true);
  out = JSON.stringify(buildMotion3(m), null, 2); $('#json').textContent = out;
  $('#fname').value = m.name.replace(/\s+/g, '_') + '.motion3.json'; $('#dlg').showModal();
};
$('#dClose').onclick = () => $('#dlg').close();
$('#dCopy').onclick = () => navigator.clipboard.writeText(out).then(() => toast('JSON disalin'), () => toast('Gagal menyalin', true));
$('#dDl').onclick = () => { const a = el('a'); a.href = URL.createObjectURL(new Blob([out], { type: 'application/json' })); a.download = $('#fname').value || 'motion.motion3.json'; a.click(); toast('Diunduh'); };

/* ---------- Render ---------- */
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button,.pane').forEach(x => x.classList.remove('on')); b.classList.add('on'); $('#' + b.dataset.p).classList.add('on');
});
subscribe(s => {
  const m = active();
  $('#mname').textContent = s.project.modelName || 'Motion Editor';
  $('#status').textContent = s.model ? 'Siap' : 'Belum dimuat';
  $('#bPlay').textContent = s.playing ? 'Pause' : 'Play';
  $('#cLoop').checked = !!m?.loop; $('#dur').value = m?.totalFrames ?? 150;
  if (!s.playing) { evalAt(s.frame); }
  paintTransport(); syncParams(); renderMotions(); renderTimeline();
  if (s.params.length !== document.querySelectorAll('.row').length && !s.q && s.filter === 'All') renderParams();
});
/* ---------- Undo/redo ---------- */
const doUndo = () => { stop(); undo(); }, doRedo = () => { stop(); redo(); };
$('#bUndo').onclick = doUndo; $('#bRedo').onclick = doRedo;
addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || /^(search|text|number)$/.test(e.target.type)) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); } else if (k === 'y') { e.preventDefault(); doRedo(); }
});
$('#newMode').onchange = e => state.newMode = e.target.value;
subscribe(() => { $('#bUndo').disabled = !history.canUndo(); $('#bRedo').disabled = !history.canRedo(); });

/* ---------- Import motion, simpan/muat project ---------- */
const saveFile = (text, name) => { const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1e4); };
const errMsg = e => e instanceof SyntaxError ? 'bukan file JSON yang valid' : e.message;
async function importMotions(files) {
  const ids = state.params.length ? new Set(state.params.map(p => p.id)) : null;
  for (const f of files) {
    try {
      const { warnings, ...d } = parseMotion3(JSON.parse(await f.text()), { ids });
      stop(); dispatch(s => { Object.assign(newMotion(f.name.replace(/(\.motion3)?\.json$/i, '')), d); s.frame = 0; }, 'import');
      if (warnings.length) { console.warn(warnings); toast(`Diimpor "${f.name}", ${warnings.length} peringatan: ${warnings[0]}`); } else toast('Diimpor: ' + f.name);
    } catch (e) { console.error(e); toast(`${f.name}: ${errMsg(e)}`, true); }
  }
}
async function openProject(f) {
  try {
    const p = parseProject(await f.text()), old = p.modelName; stop();
    if (modelName) p.modelName = modelName;
    const ids = new Set(state.params.map(x => x.id)), miss = state.params.length ? new Set(p.motions.flatMap(m => m.tracks.map(t => t.paramId)).filter(i => !ids.has(i))).size : 0;
    loadProject(p);
    toast(old && modelName && old !== modelName ? `Project dimuat (dibuat untuk model "${old}")` : miss ? `Project dimuat, ${miss} parameter tidak ada di model` : 'Project dimuat');
  } catch (e) { console.error(e); toast(`${f.name}: ${errMsg(e)}`, true); }
}
$('#mnSave').onclick = () => { saveFile(serializeProject(state.project), (modelName || 'project') + '.l2dproj.json'); toast('Project disimpan'); };
$('#mnImp').onclick = $('#mImp').onclick = () => $('#fMotion').click();
$('#mnLoad').onclick = () => $('#fProj').click();
$('#fMotion').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; importMotions(fs); };
$('#fProj').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); };
const menu = $('#menu'), setMenu = o => { menu.hidden = !o; $('#bMenu').setAttribute('aria-expanded', o); };
$('#bMenu').onclick = e => { e.stopPropagation(); setMenu(menu.hidden); };
addEventListener('click', () => setMenu(false)); addEventListener('keydown', e => e.key === 'Escape' && setMenu(false));

/* ---------- Autosave (IndexedDB) ---------- */
const hasWork = p => p.motions.some(m => m.tracks.length);
let saveT, lastJ = '', savedOnce = false, warned = false;
function flush() {
  const j = JSON.stringify(state.project);
  if (!armed || j === lastJ || !(savedOnce || hasWork(state.project))) return;
  lastJ = j; savedOnce = true;
  saveAuto('proj:' + modelName, { modelName, savedAt: Date.now(), project: JSON.parse(j) }).catch(e => { console.warn('Autosave gagal', e); if (!warned) { warned = true; toast('Autosave tidak tersedia di browser ini', true); } });
}
subscribe(() => { clearTimeout(saveT); saveT = setTimeout(flush, 500); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
async function offerRestore(name) {
  try {
    const rec = await loadAuto('proj:' + name);
    if (rec?.project && hasWork(rec.project) && !hasWork(state.project)) {
      if (confirm(`Pulihkan pekerjaan terakhir untuk "${name}"? (disimpan ${new Date(rec.savedAt).toLocaleString('id-ID')})`)) {
        const p = parseProject(JSON.stringify(rec.project)); p.modelName = name; loadProject(p); savedOnce = true; toast('Pekerjaan dipulihkan');
      } else await clearAuto('proj:' + name);
    }
  } catch (e) { console.warn('Autosave tidak tersedia', e); }
  armed = true;
}

newMotion(); renderChips(); dispatch(() => {});

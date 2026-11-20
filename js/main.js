import { state, subscribe, dispatch, active, newMotion, history, undo, redo, loadProject } from './state.js';
import { evalTrack, getTrack, keyAt, toggleKey, refreshEase, setMode, modeOf, MODES } from './motion/interp.js';
import { buildMotion3, parseMotion3 } from './io/motion3.js';
import { serializeProject, parseProject } from './io/project.js';
import { saveAuto, loadAuto, clearAuto } from './io/storage.js';
import { loadModelFiles } from './model/loader.js';
import { readParams } from './model/params.js';
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
app.renderer.on('resize', fit);

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
function unload() { if (state.model) { app.stage.removeChild(state.model); state.model.destroy(); } stop(); dispatch(s => { s.model = null; s.params = []; s.values = {}; }); $('#drop').classList.remove('hide'); }
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

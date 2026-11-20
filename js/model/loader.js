/** Baca file/zip, petakan path relatif ke blob URL, lalu muat model Cubism 3+. */
export async function loadModelFiles(fileList) {
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
  const jsonUrl = URL.createObjectURL(new Blob([JSON.stringify(json)], { type: 'application/json' }));
  let model;
  try { model = await PIXI.live2d.Live2DModel.from(jsonUrl, { autoInteract: false, motionPreload: PIXI.live2d.MotionPreloadStrategy?.NONE }); }
  catch (e) {
    const f = names.get(e?.url);
    throw new Error(f ? `Gagal membaca "${f}" (${e.message || 'error'})` : `Gagal memuat model: ${e?.message || e}`);
  }
  return { model, name: jp.split('/').pop().replace(/\.model3\.json$/i, '') };
}

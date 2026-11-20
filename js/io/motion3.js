import { controlPoints } from '../motion/interp.js';
const r = n => Math.round(n * 1e4) / 1e4;
/** Bangun .motion3.json (linear=0, bezier=1, stepped=2). Fungsi murni. */
export function buildMotion3(m) {
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
export function parseMotion3(json, { ids } = {}) {
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

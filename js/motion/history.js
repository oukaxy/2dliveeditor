/** Riwayat undo/redo berbasis snapshot string. Murni: tanpa DOM. */
export function createHistory(limit = 50, now = Date.now) {
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

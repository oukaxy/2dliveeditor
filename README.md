# Live2D Motion Editor

Editor motion berbasis web (mobile-first) untuk model Live2D Cubism 3/4/5: atur parameter dengan slider, taruh keyframe di timeline, putar ulang di model, lalu export `.motion3.json`. Semua berjalan di browser, tanpa backend dan tanpa build step.

## Menjalankan

```bash
npx serve .        # atau Live Server di VS Code; jangan buka lewat file://
npm test           # tes unit (Node 20+, node --test)
```

Library dimuat dari CDN dengan versi dipin: PixiJS 6.5.10, pixi-live2d-display 0.4.0 (Cubism 4), fflate 0.8.2, dan Cubism Core resmi dari live2d.com. Butuh koneksi internet saat pertama dibuka.

## Memuat model

Pilih beberapa file sekaligus (`.model3.json`, `.moc3`, tekstur, dst.) atau satu `.zip`. **Drag-drop folder tidak didukung**; gunakan multi-file atau zip. Model Cubism 2 tidak didukung.

## Fitur

- **Parameter**: slider real-time, pencarian, filter kategori.
- **Keyframe**: tombol ◆ di playhead; mengubah slider tepat di keyframe memperbarui nilainya. Mode keyframe baru dipilih di tab Timeline: Linear, Stepped, Ease in-out, Ease in, Ease out. Ketuk dua kali sebuah marker untuk berganti mode (◆ linear, ■ stepped, ● ease).
- **Motion**: baru, ganti nama, duplikat, hapus, import. Durasi (frame) dan Loop diubah di transport bar.
- **Export** `.motion3.json` (linear, stepped, bezier).
- **Import** `.motion3.json` (termasuk bezier). Parameter yang tidak ada di model dilewati dengan peringatan.
- **Project** `.l2dproj.json`: menu Menu → Simpan/Muat project.
- **Autosave** ke IndexedDB (debounce 500 ms), per nama model. Saat model yang sama dimuat lagi, aplikasi menawarkan pemulihan.
- **Undo/redo** maksimal 50 langkah (tombol ↶ ↷, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z atau Ctrl+Y). Drag slider dihitung satu langkah.

## Catatan teknis

- Waktu disimpan dalam frame; export mengonversi ke detik (`frame / fps`).
- **Bezier**: handle disimpan relatif (`out` terhadap keyframe ini, `in` terhadap keyframe berikutnya). Preset ease memakai titik kontrol waktu di 1/3 dan 2/3 segmen, sehingga cocok dengan `AreBeziersRestricted: true` di semua versi runtime Cubism. Jika file yang diimpor punya handle waktu non-1/3, export menulis `AreBeziersRestricted: false`.
- Segmen *inverse stepped* (kode 3) saat import diubah menjadi stepped dengan peringatan.
- Mengubah nilai keyframe ber-preset ease menurunkan ulang handle-nya; handle bezier hasil import tidak diubah.
- Struktur sedikit berbeda dari PRD: CSS satu file (`css/app.css`) dan komponen UI ada di `js/main.js`.

```
index.html  css/app.css
js/main.js            bootstrap + UI
js/state.js           store, dispatch, undo/redo
js/model/             loader.js, params.js
js/motion/            interp.js, history.js   (murni)
js/io/                motion3.js, project.js  (murni), storage.js (IndexedDB)
test/                 node --test
```

## Lisensi

**Cubism Core** (`live2dcubismcore.min.js`) adalah milik Live2D Inc. dan penggunaannya tunduk pada [lisensi mereka](https://www.live2d.com/en/sdk/license/). File ini tidak disertakan di repo; dimuat dari URL resmi. Model sample Live2D juga punya aturan penggunaan sendiri.

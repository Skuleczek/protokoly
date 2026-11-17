// ============================================================
// zdjecia.js – zamiana zdjęć na jeden plik PDF.
// Wszystko dzieje się w telefonie: bez internetu, bez AI, bez kosztów,
// bez znaków wodnych i bez limitu liczby zdjęć.
// ============================================================

import { PDFDocument } from '../lib/pdf-lib.js';

const A4 = [595.28, 841.89];
const MARGINES = 18; // pt

// Wczytuje zdjęcie (z uwzględnieniem obrotu zapisanego przez aparat)
// i zapisuje je jako JPEG o dłuższym boku najwyżej "maxBok" pikseli.
async function przeskaluj(plik, maxBok, jakosc) {
  const adres = URL.createObjectURL(plik);
  try {
    const img = new Image();
    img.src = adres;
    await img.decode();
    const skala = Math.min(1, maxBok / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * skala));
    const h = Math.max(1, Math.round(img.naturalHeight * skala));
    const plotno = document.createElement('canvas');
    plotno.width = w; plotno.height = h;
    const ctx = plotno.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // przezroczystość (PNG) -> białe tło
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((ok) => plotno.toBlob(ok, 'image/jpeg', jakosc));
    plotno.width = 0; plotno.height = 0; // zwolnij pamięć
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(adres);
  }
}

// Mała miniatura do podglądu na liście.
export async function miniatura(plik) {
  const { blob } = await przeskaluj(plik, 320, 0.7);
  return URL.createObjectURL(blob);
}

/**
 * @param {File[]} pliki – zdjęcia w kolejności stron
 * @param {(zrobione:number, wszystkie:number) => void} postep
 * @returns {Promise<Uint8Array>}
 */
export async function zdjeciaDoPdf(pliki, postep = () => {}) {
  const pdf = await PDFDocument.create();
  let pominiete = 0;
  for (let i = 0; i < pliki.length; i++) {
    let zdj;
    try { zdj = await przeskaluj(pliki[i], 2000, 0.85); } catch (e) {
      pominiete++; // plik, którego przeglądarka nie umie odczytać – pomijamy, reszta idzie dalej
      postep(i + 1, pliki.length, pominiete);
      continue;
    }
    const { blob, w, h } = zdj;
    const obraz = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const [W, H] = w > h ? [A4[1], A4[0]] : A4; // poziome zdjęcie -> pozioma strona
    const skala = Math.min((W - 2 * MARGINES) / w, (H - 2 * MARGINES) / h);
    const strona = pdf.addPage([W, H]);
    strona.drawImage(obraz, {
      x: (W - w * skala) / 2, y: (H - h * skala) / 2, width: w * skala, height: h * skala,
    });
    postep(i + 1, pliki.length, pominiete);
    await new Promise((ok) => setTimeout(ok, 0)); // daj telefonowi odetchnąć
  }
  if (!pdf.getPageCount()) throw new Error('Żadnego z wybranych plików nie udało się odczytać jako zdjęcia.');
  pdf.setTitle('Zdjęcia');
  pdf.setCreator('Protokoły kontroli');
  pdf.setProducer('Protokoły kontroli');
  return pdf.save();
}

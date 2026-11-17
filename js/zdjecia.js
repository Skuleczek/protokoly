// ============================================================
// zdjecia.js – zamiana zdjęć na jeden plik PDF.
// Wszystko dzieje się w telefonie: bez internetu, bez AI, bez kosztów,
// bez znaków wodnych i bez limitu liczby zdjęć.
// Każde zdjęcie: { plik, rogi, filtr, obrot } – przycięcie/wyprostowanie
// kartki, filtr i obrót liczy skaner.js.
// ============================================================

import { PDFDocument } from '../lib/pdf-lib.js';
import * as S from './skaner.js';

const A4 = [595.28, 841.89];
const MARGINES = 18; // pt

// Nowe zdjęcie: automatyczne wykrycie kartki (gdy włączone) + miniatura.
export async function przygotuj(z, { autoKadrowanie }) {
  const img = await S.wczytajObraz(z.plik);
  if (!z.rogi) z.rogi = (autoKadrowanie && S.wykryjKartke(img)) || S.CALE_ZDJECIE.map((r) => [...r]);
  z.mini = await miniatura(z, img);
}

// Mała miniatura do podglądu na liście (już przycięta, z filtrem i obrotem).
export async function miniatura(z, img = null) {
  const obraz = img || await S.wczytajObraz(z.plik);
  const c = S.przetworz(obraz, z, 360);
  const blob = await S.doJpeg(c, 0.75);
  c.width = 0;
  return URL.createObjectURL(blob);
}

/**
 * @param {Array<{plik, rogi, filtr, obrot}>} zdjecia – w kolejności stron
 * @param {(zrobione:number, wszystkie:number, pominiete:number) => void} postep
 * @returns {Promise<Uint8Array>}
 */
export async function zdjeciaDoPdf(zdjecia, postep = () => {}) {
  const pdf = await PDFDocument.create();
  let pominiete = 0;
  for (let i = 0; i < zdjecia.length; i++) {
    let c;
    try {
      const img = await S.wczytajObraz(zdjecia[i].plik);
      c = S.przetworz(img, zdjecia[i], 2000);
    } catch (e) {
      pominiete++; // plik, którego przeglądarka nie umie odczytać – pomijamy, reszta idzie dalej
      postep(i + 1, zdjecia.length, pominiete);
      continue;
    }
    const w = c.width; const h = c.height;
    const blob = await S.doJpeg(c, 0.85);
    c.width = 0; // zwolnij pamięć
    const obraz = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const [W, H] = w > h ? [A4[1], A4[0]] : A4; // poziome zdjęcie -> pozioma strona
    const skala = Math.min((W - 2 * MARGINES) / w, (H - 2 * MARGINES) / h);
    const strona = pdf.addPage([W, H]);
    strona.drawImage(obraz, {
      x: (W - w * skala) / 2, y: (H - h * skala) / 2, width: w * skala, height: h * skala,
    });
    postep(i + 1, zdjecia.length, pominiete);
    await new Promise((ok) => setTimeout(ok, 0)); // daj telefonowi odetchnąć
  }
  if (!pdf.getPageCount()) throw new Error('Żadnego z wybranych plików nie udało się odczytać jako zdjęcia.');
  pdf.setTitle('Zdjęcia');
  pdf.setCreator('Protokoły kontroli');
  pdf.setProducer('Protokoły kontroli');
  return pdf.save();
}

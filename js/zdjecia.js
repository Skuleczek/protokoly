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

// Położenie zdjęcia na stronie A4 (w punktach, y liczone od góry).
// Poziome zdjęcie -> pozioma strona. Ten sam układ dla PDF i podglądu.
export function ukladStrony(w, h) {
  const [W, H] = w > h ? [A4[1], A4[0]] : A4;
  const skala = Math.min((W - 2 * MARGINES) / w, (H - 2 * MARGINES) / h);
  return { W, H, w: w * skala, h: h * skala, x: (W - w * skala) / 2, y: (H - h * skala) / 2 };
}

// Obrazek jednej strony PDF do podglądu (biała kartka A4 ze zdjęciem).
export async function stronaPodgladu(z, szerokosc = 700) {
  const img = await S.wczytajObraz(z.plik);
  const c = S.przetworz(img, z, 1200);
  const u = ukladStrony(c.width, c.height);
  const s = szerokosc / A4[0]; // ta sama skala dla stron pionowych i poziomych
  const strona = document.createElement('canvas');
  strona.width = Math.round(u.W * s); strona.height = Math.round(u.H * s);
  const ctx = strona.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, strona.width, strona.height);
  ctx.drawImage(c, u.x * s, u.y * s, u.w * s, u.h * s);
  c.width = 0;
  const blob = await S.doJpeg(strona, 0.8);
  strona.width = 0;
  return { adres: URL.createObjectURL(blob), pozioma: u.W > u.H };
}

// Gotowe pliki JPEG -> PDF bez żadnych zmian (zdjęcia przeglądu).
// @param {Array<{blob, szer, wys}>} pliki
export async function jpgDoPdf(pliki) {
  const pdf = await PDFDocument.create();
  for (const p of pliki) {
    const obraz = await pdf.embedJpg(new Uint8Array(await p.blob.arrayBuffer()));
    const u = ukladStrony(obraz.width, obraz.height);
    const strona = pdf.addPage([u.W, u.H]);
    strona.drawImage(obraz, { x: u.x, y: u.H - u.y - u.h, width: u.w, height: u.h });
  }
  pdf.setTitle('Zdjęcia');
  pdf.setCreator('Protokoły kontroli');
  pdf.setProducer('Protokoły kontroli');
  return pdf.save();
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
    const u = ukladStrony(c.width, c.height);
    const blob = await S.doJpeg(c, 0.85);
    c.width = 0; // zwolnij pamięć
    const obraz = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const strona = pdf.addPage([u.W, u.H]);
    strona.drawImage(obraz, { x: u.x, y: u.H - u.y - u.h, width: u.w, height: u.h });
    postep(i + 1, zdjecia.length, pominiete);
    await new Promise((ok) => setTimeout(ok, 0)); // daj telefonowi odetchnąć
  }
  if (!pdf.getPageCount()) throw new Error('Żadnego z wybranych plików nie udało się odczytać jako zdjęcia.');
  pdf.setTitle('Zdjęcia');
  pdf.setCreator('Protokoły kontroli');
  pdf.setProducer('Protokoły kontroli');
  return pdf.save();
}

// ============================================================
// zdjecia-przegladu.js – zdjęcia dołączone do przeglądu.
// Zapisywane we wspólnej bazie (Firestore), widoczne dla całego zespołu.
// Każde zdjęcie to dwa dokumenty:
//   zdjecia/{id}      – mała miniatura i opis (szybka lista na ekranie przeglądu),
//   zdjeciaDane/{id}  – pełne zdjęcie (pobierane dopiero do PDF).
// Bez internetu zdjęcie czeka w telefonie i wysyła się samo (jak protokoły).
// ============================================================

import { baza, noweId } from './baza.js';
import { sesja } from './chmura.js';
import * as S from './skaner.js';

const MAKS_BOK = 1600;        // px – czytelne na całej stronie A4
const MAKS_BAJTOW = 650000;   // pełne zdjęcie (dokument Firestore ma limit ok. 1 MB)
const MINI_BOK = 220;

const naDataUrl = (blob) => new Promise((ok, blad) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => blad(r.error);
  r.readAsDataURL(blob);
});
export const zDataUrl = async (adres) => (await fetch(adres)).blob();

// Zmniejsza zdjęcie i zapisuje JPEG; przy dużym pliku obniża jakość/rozmiar.
async function przygotujJpeg(img) {
  let bok = MAKS_BOK; let jakosc = 0.8; let blob; let c;
  for (let proba = 0; proba < 6; proba++) {
    c = S.pomniejsz(img, bok);
    blob = await S.doJpeg(c, jakosc);
    if (blob.size * 1.37 <= MAKS_BAJTOW) break; // base64 jest o ok. 1/3 większy
    if (jakosc > 0.55) jakosc -= 0.1; else bok = Math.round(bok * 0.8);
    c.width = 0;
  }
  const wynik = { blob, szer: c.width, wys: c.height };
  c.width = 0;
  return wynik;
}

/**
 * Dodaje zdjęcia do przeglądu. Zapis nie czeka na serwer.
 * @returns {Promise<{dodane:number, pominiete:number}>}
 */
export async function dodajZdjecia(przeglad, pliki, postep = () => {}) {
  let dodane = 0; let pominiete = 0;
  const lista = [...pliki];
  for (let i = 0; i < lista.length; i++) {
    postep(i, lista.length);
    let img;
    try { img = await S.wczytajObraz(lista[i]); } catch (e) { pominiete++; continue; }
    const { blob, szer, wys } = await przygotujJpeg(img);
    const m = S.pomniejsz(img, MINI_BOK);
    const mini = await naDataUrl(await S.doJpeg(m, 0.6));
    m.width = 0;
    const dane = await naDataUrl(blob);
    const id = noweId();
    const teraz = Date.now() + i; // zachowuje kolejność wyboru
    const wspolne = { id, przegladId: przeglad.id, grupaId: przeglad.grupaId, autor: sesja.konto };
    await baza.zapisz('zdjeciaDane', { ...wspolne, dane });
    await baza.zapisz('zdjecia', { ...wspolne, mini, szer, wys, rozmiar: dane.length, autorImie: sesja.imie, utworzono: teraz });
    dodane++;
    await new Promise((ok) => setTimeout(ok, 0)); // daj telefonowi odetchnąć
  }
  postep(lista.length, lista.length);
  return { dodane, pominiete };
}

// Zdjęcia przeglądu (miniatury) w kolejności dodania.
export async function zdjeciaPrzegladu(przegladId) {
  const lista = await baza.wgIndeksu('zdjecia', 'przegladId', przegladId);
  return lista.sort((a, b) => a.utworzono - b.utworzono);
}

export function usunZdjecie(id) {
  baza.usun('zdjeciaDane', id);
  return baza.usun('zdjecia', id);
}

// Usuwa wszystkie zdjęcia przeglądu (przy usuwaniu przeglądu lub grupy).
export async function usunZdjeciaPrzegladu(przegladId) {
  for (const z of await baza.wgIndeksu('zdjecia', 'przegladId', przegladId)) await usunZdjecie(z.id);
}

/**
 * PDF ze zdjęć przeglądu – bez filtrów i przycinania, jedno zdjęcie na stronę A4.
 * @returns {Promise<{bajty:Uint8Array, brakujace:number}>}
 */
export async function pdfZdjec(zdjecia, postep = () => {}) {
  const { jpgDoPdf } = await import('./zdjecia.js');
  const pliki = [];
  let brakujace = 0;
  for (let i = 0; i < zdjecia.length; i++) {
    postep(i, zdjecia.length);
    const d = await baza.pobierz('zdjeciaDane', zdjecia[i].id);
    if (!d || !d.dane) { brakujace++; continue; } // np. jeszcze niewysłane z innego telefonu
    pliki.push({ blob: await zDataUrl(d.dane), szer: zdjecia[i].szer, wys: zdjecia[i].wys });
  }
  if (!pliki.length) throw new Error('Nie udało się pobrać żadnego zdjęcia. Sprawdź internet.');
  return { bajty: await jpgDoPdf(pliki), brakujace };
}

// ============================================================
// zapis.js – gdzie zapisywać gotowe pliki (PDF, kopie zapasowe).
// Tryby (ustawienie tylko na tym urządzeniu):
//   pobrane – zwykłe pobieranie (folder „Pobrane”), działa wszędzie,
//   pytaj   – okno wyboru folderu i nazwy przy każdym zapisie,
//   folder  – stały folder wybrany raz w Ustawieniach.
// „pytaj” i „folder” działają tylko tam, gdzie przeglądarka to umożliwia
// (Chrome/Edge na komputerze, część telefonów z Androidem). Na iPhonie – nie.
// ============================================================

import { baza } from './baza.js';

const KLUCZ = 'zapisPdf';
const ID_FOLDERU = 'folderPdf';

export const obsluga = {
  pytaj: typeof window !== 'undefined' && 'showSaveFilePicker' in window,
  folder: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
};

export function tryb() {
  let t = 'pobrane';
  try { t = localStorage.getItem(KLUCZ) || 'pobrane'; } catch (e) { /* trudno */ }
  return obsluga[t] ? t : 'pobrane'; // tryb nieobsługiwany na tym urządzeniu = zwykłe pobieranie
}
export function ustawTryb(t) { try { localStorage.setItem(KLUCZ, t); } catch (e) { /* trudno */ } }

export async function folder() {
  try { const w = await baza.pobierz('ustawienia', ID_FOLDERU); return w ? w.uchwyt : null; } catch (e) { return null; }
}

// Okno wyboru folderu (musi być wywołane po dotknięciu przycisku).
export async function wybierzFolder() {
  const uchwyt = await window.showDirectoryPicker({ id: 'protokoly-pdf', mode: 'readwrite', startIn: 'downloads' });
  await baza.zapisz('ustawienia', { id: ID_FOLDERU, uchwyt });
  return uchwyt.name;
}

// Czy wolno pisać do folderu (po ponownym uruchomieniu przeglądarka pyta jeszcze raz).
async function pozwolenie(uchwyt) {
  const opcje = { mode: 'readwrite' };
  if ((await uchwyt.queryPermission(opcje)) === 'granted') return true;
  return (await uchwyt.requestPermission(opcje)) === 'granted';
}

// Wolna nazwa w folderze: „plik.pdf”, „plik (2).pdf”, …
async function wolnaNazwa(uchwyt, nazwa) {
  const kropka = nazwa.lastIndexOf('.');
  const rdzen = kropka > 0 ? nazwa.slice(0, kropka) : nazwa;
  const rozsz = kropka > 0 ? nazwa.slice(kropka) : '';
  for (let n = 1; n < 100; n++) {
    const proba = n === 1 ? nazwa : `${rdzen} (${n})${rozsz}`;
    try { await uchwyt.getFileHandle(proba); } catch (e) { return proba; } // nie istnieje = wolna
  }
  return `${rdzen} ${Date.now()}${rozsz}`;
}

/**
 * Zapisuje plik według ustawienia.
 * @returns {Promise<{stan:'zapisano', gdzie:string}|{stan:'anulowano'}|{stan:'pobierz'}>}
 *   'pobierz' = użyj zwykłego pobierania (tryb „pobrane” albo brak folderu).
 */
export async function zapiszPlik(plik, nazwa) {
  const t = tryb();
  if (t === 'pytaj') {
    try {
      const rozsz = (nazwa.match(/\.[a-z0-9]+$/i) || ['.pdf'])[0].toLowerCase();
      const uchwyt = await window.showSaveFilePicker({
        suggestedName: nazwa,
        types: [{ description: rozsz === '.json' ? 'Kopia zapasowa' : 'Dokument PDF', accept: { [plik.type || 'application/pdf']: [rozsz] } }],
      });
      const w = await uchwyt.createWritable();
      await w.write(plik); await w.close();
      return { stan: 'zapisano', gdzie: uchwyt.name };
    } catch (e) {
      if (e.name === 'AbortError') return { stan: 'anulowano' };
      throw e;
    }
  }
  if (t === 'folder') {
    const uchwyt = await folder();
    if (!uchwyt) return { stan: 'pobierz' };
    if (!(await pozwolenie(uchwyt))) throw new Error('Brak zgody na zapis w folderze. Wybierz folder ponownie w Ustawieniach.');
    const wolna = await wolnaNazwa(uchwyt, nazwa);
    const p = await uchwyt.getFileHandle(wolna, { create: true });
    const w = await p.createWritable();
    await w.write(plik); await w.close();
    return { stan: 'zapisano', gdzie: `${uchwyt.name}/${wolna}` };
  }
  return { stan: 'pobierz' };
}

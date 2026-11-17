// ============================================================
// protokol.js – logika protokołu (bez wyglądu).
// Struktura protokołu pochodzi z pliku dane/szablon.json.
// ============================================================

import { noweId } from './baza.js';

let szablon = null;

export async function wczytajSzablon() {
  if (!szablon) {
    const odp = await fetch('dane/szablon.json');
    szablon = await odp.json();
  }
  return szablon;
}

export const pobierzSzablon = () => szablon;

export function dzisiaj() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "2026-11-17" -> "17.11.2026"
export function dataPL(iso) {
  if (!iso) return '';
  const [r, m, d] = iso.split('-');
  return `${d}.${m}.${r}`;
}

/*
 Wygląd zapisanego protokołu:
 {
   id, przegladId, grupaId, utworzono, zmieniono,
   naglowek: { typ, nrFabr, rok, oznaczenie },   // OBIEKT = nazwa grupy (nie zapisujemy osobno)
   sekcje:   { "1": "jest" | "brak" | null, ... },
   punkty:   { "1.1": { stan: "poz"|"neg"|null, dod: true|false|"tekst" },
               "1.6": { pobor: "", znamionowy: "", bezpiecznik: "" } },
   dataKontroli: "2026-11-17",
   termin: "",             // termin następnego przeglądu
   uwagi: "",
   flagi: { "1.6.pobor": { typ: "uzupelnij"|"sprawdz", cytat: "..." } },   // etap 4
   podpis: null            // miejsce na przyszły podpis palcem (obrazek)
 }
*/
export function nowyProtokol(przeglad, zmiany = {}) {
  const teraz = Date.now();
  return {
    id: noweId(),
    przegladId: przeglad.id,
    grupaId: przeglad.grupaId,
    utworzono: teraz,
    zmieniono: teraz,
    naglowek: { typ: '', nrFabr: '', rok: '', oznaczenie: '' },
    sekcje: {},
    punkty: {},
    dataKontroli: przeglad.data,
    termin: '',
    uwagi: '',
    flagi: {},
    podpis: null,
    ...zmiany,
  };
}

const znajdzSekcje = (nr) => szablon.sekcje.find((s) => s.nr === nr);
const znajdzPunkt = (nr) => szablon.sekcje.flatMap((s) => s.punkty).find((p) => p.nr === nr);
const sekcjaPunktu = (nrPunktu) => nrPunktu.split('.')[0];

function wpisPunktu(p, nr) {
  if (!p.punkty[nr]) p.punkty[nr] = {};
  return p.punkty[nr];
}

// Każda ręczna zmiana pola kasuje jego flagę "do sprawdzenia"/"do uzupełnienia".
function usunFlagi(p, prefiks) {
  for (const k of Object.keys(p.flagi || {})) {
    if (k === prefiks || k.startsWith(prefiks + '.')) delete p.flagi[k];
  }
}

// "✓ Sekcja OK": jest + wszystkie odpowiedzi pozytywne (pola liczbowe bez zmian).
export function sekcjaOK(p, nr) {
  const s = znajdzSekcje(nr);
  p.sekcje[nr] = 'jest';
  usunFlagi(p, nr);
  for (const pkt of s.punkty) {
    if (pkt.typ !== 'wybor' || pkt.opcjonalny) continue; // punkt opcjonalny (np. 1.4) – bez zmian
    const w = wpisPunktu(p, pkt.nr);
    w.stan = 'poz';
    if (pkt.dodatkowe && pkt.dodatkowe.typ === 'zaznacz') w.dod = false;
  }
}

// Przycisk "jest"/"brak" sekcji. Ponowne dotknięcie odznacza.
export function ustawSekcje(p, nr, wartosc) {
  p.sekcje[nr] = p.sekcje[nr] === wartosc ? null : wartosc;
  usunFlagi(p, nr);
}

// Przycisk pozytywna/negatywna w punkcie. Ponowne dotknięcie odznacza.
export function ustawPunkt(p, nr, stan) {
  const w = wpisPunktu(p, nr);
  w.stan = w.stan === stan ? null : stan;
  w.auto = false; // wybór ręczny
  // Dotknięcie punktu oznacza, że sekcja istnieje.
  const s = sekcjaPunktu(nr);
  if (!p.sekcje[s]) p.sekcje[s] = 'jest';
  usunFlagi(p, nr);
}

// Kratka "do wymiany" / "do wyczyszczenia".
export function przelaczDodatkowe(p, nr) {
  const w = wpisPunktu(p, nr);
  w.dod = !w.dod;
  if (w.dod && !w.stan) w.stan = 'neg'; // "do wymiany" zwykle idzie z negatywną
  const s = sekcjaPunktu(nr);
  if (!p.sekcje[s]) p.sekcje[s] = 'jest';
  usunFlagi(p, nr);
}

// Pola tekstowe: "nastawa" (pole "dod"), "rozmiar" łożyska
// i pola liczbowe (pobor, znamionowy, bezpiecznik).
export function ustawPole(p, nr, pole, wartosc) {
  const w = wpisPunktu(p, nr);
  w[pole] = wartosc;
  usunFlagi(p, `${nr}.${pole}`);
  if (pole === 'dod') {
    usunFlagi(p, nr);
    // Punkt opcjonalny (1.4, 2.4): wpisanie nastawy zaznacza "poprawne" (można zmienić),
    // skasowanie nastawy cofa takie automatyczne zaznaczenie.
    if (znajdzPunkt(nr).opcjonalny) {
      const wpisano = String(wartosc).trim() !== '';
      if (wpisano && !w.stan) { w.stan = 'poz'; w.auto = true; }
      if (!wpisano && w.auto) { w.stan = null; w.auto = false; }
      const s = sekcjaPunktu(nr);
      if (wpisano && !p.sekcje[s]) p.sekcje[s] = 'jest';
    }
  }
}

// Kopiuje z innego protokołu tylko informację, które sekcje są, a których brak.
export function kopiujBudowe(p, zrodlo) {
  p.sekcje = { ...zrodlo.sekcje };
}

// Ile pól jeszcze brakuje (do plakietki na liście central).
export function postep(p) {
  let brakuje = 0;
  for (const s of szablon.sekcje) {
    const stan = p.sekcje[s.nr];
    if (!stan) { brakuje++; continue; }
    if (stan === 'brak') continue;
    for (const pkt of s.punkty) {
      const w = p.punkty[pkt.nr] || {};
      if (pkt.typ === 'wybor') {
        if (!w.stan && !pkt.opcjonalny) brakuje++;
      } else {
        for (const pole of pkt.pola) if (!String(w[pole.id] ?? '').trim()) brakuje++;
      }
    }
  }
  const flagi = Object.keys(p.flagi || {}).length;
  return { brakuje, flagi, gotowy: brakuje === 0 && flagi === 0 };
}

export function opisCentrali(p) {
  const n = p.naglowek || {};
  const czesci = [n.oznaczenie, n.typ].filter((x) => x && x.trim());
  return czesci.length ? czesci.join(' – ') : 'Centrala bez nazwy';
}

// Czy dwa protokoły dotyczą tej samej centrali (do kopiowania z poprzedniego przeglądu).
export function tenSamUrzadzenie(a, b) {
  const norm = (x) => String(x || '').trim().toLowerCase();
  if (norm(a.naglowek.nrFabr) && norm(a.naglowek.nrFabr) === norm(b.naglowek.nrFabr)) return true;
  return !!norm(a.naglowek.oznaczenie) && norm(a.naglowek.oznaczenie) === norm(b.naglowek.oznaczenie)
    && norm(a.naglowek.typ) === norm(b.naglowek.typ);
}

export { znajdzPunkt, znajdzSekcje };

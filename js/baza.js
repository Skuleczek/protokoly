// ============================================================
// baza.js – zapis danych w pamięci telefonu (IndexedDB).
// Dwie części:
//  - lokalna (IndexedDB w telefonie): ustawienia, klucze API, nagrania,
//  - wspólna (Firebase): grupy, przeglądy, protokoły – widoczne dla zespołu.
// ============================================================

import { fs, F } from './chmura.js';

const NAZWA_BAZY = 'protokoly';
const WERSJA_BAZY = 1;

// Tabele w bazie:
//  grupy      – klienci (np. "Budimex sp. z o. o.")
//  przeglady  – daty przeglądów w danej grupie
//  protokoly  – protokoły poszczególnych central
//  ustawienia – klucze API, słownik itp. (od etapu 5)
//  nagrania   – kolejka nagrań czekających na internet (od etapu 3)
export const TABELE = ['grupy', 'przeglady', 'protokoly', 'ustawienia', 'nagrania'];

let otwarcie = null;

function otworz() {
  if (!otwarcie) {
    otwarcie = new Promise((ok, blad) => {
      const zadanie = indexedDB.open(NAZWA_BAZY, WERSJA_BAZY);
      zadanie.onupgradeneeded = () => {
        const db = zadanie.result;
        const utworz = (nazwa, indeksy = []) => {
          if (db.objectStoreNames.contains(nazwa)) return;
          const tabela = db.createObjectStore(nazwa, { keyPath: 'id' });
          indeksy.forEach((i) => tabela.createIndex(i, i));
        };
        utworz('grupy');
        utworz('przeglady', ['grupaId']);
        utworz('protokoly', ['przegladId', 'grupaId']);
        utworz('ustawienia');
        utworz('nagrania', ['protokolId']);
      };
      zadanie.onsuccess = () => ok(zadanie.result);
      zadanie.onerror = () => blad(zadanie.error);
    });
  }
  return otwarcie;
}

// Wykonuje jedną operację na tabeli i czeka, aż zapis naprawdę się zakończy.
async function wykonaj(tabela, tryb, operacja) {
  const db = await otworz();
  return new Promise((ok, blad) => {
    const tx = db.transaction(tabela, tryb);
    const zadanie = operacja(tx.objectStore(tabela));
    tx.oncomplete = () => ok(zadanie ? zadanie.result : undefined);
    tx.onerror = () => blad(tx.error);
    tx.onabort = () => blad(tx.error);
  });
}

// Tylko w tym telefonie: ustawienia i kolejka nagrań.
const lokalnaIDB = {
  pobierz: (tabela, id) => wykonaj(tabela, 'readonly', (t) => t.get(id)),
  wszystkie: (tabela) => wykonaj(tabela, 'readonly', (t) => t.getAll()),
  wgIndeksu: (tabela, indeks, wartosc) =>
    wykonaj(tabela, 'readonly', (t) => t.index(indeks).getAll(wartosc)),
  zapisz: (tabela, obiekt) => wykonaj(tabela, 'readwrite', (t) => t.put(obiekt)),
  usun: (tabela, id) => wykonaj(tabela, 'readwrite', (t) => t.delete(id)),
};

// ------------------------------------------------------------
// Wspólna baza (Firebase): grupy, przeglądy, protokoły.
// Zapis NIE czeka na serwer – trafia od razu do pamięci telefonu,
// a Firebase sam wyśle go, gdy będzie internet.
// ------------------------------------------------------------
const WSPOLNE = ['grupy', 'przeglady', 'protokoly'];
let bladZapisu = (e) => console.error(e);
export function przyBledzieZapisu(fn) { bladZapisu = fn; }

async function odczyt(zapytanie, jedenDokument) {
  const zSerwera = jedenDokument ? F.getDoc : F.getDocs;
  const zPamieci = jedenDokument ? F.getDocFromCache : F.getDocsFromCache;
  if (!navigator.onLine) {
    try { return await zPamieci(zapytanie); } catch (e) { return null; }
  }
  // Słaby zasięg: po 4 s bez odpowiedzi serwera bierzemy dane z pamięci telefonu.
  const limit = new Promise((_, nie) => setTimeout(() => nie(new Error('wolno')), 4000));
  try { return await Promise.race([zSerwera(zapytanie), limit]); } catch (e) {
    try { return await zPamieci(zapytanie); } catch (e2) { return null; }
  }
}
const lista = (wynik) => (wynik ? wynik.docs.map((d) => d.data()) : []);

const wspolna = {
  async pobierz(tabela, id) {
    const d = await odczyt(F.doc(fs, tabela, id), true);
    return d && d.exists() ? d.data() : undefined;
  },
  async wszystkie(tabela) { return lista(await odczyt(F.collection(fs, tabela))); },
  async wgIndeksu(tabela, pole, wartosc) {
    return lista(await odczyt(F.query(F.collection(fs, tabela), F.where(pole, '==', wartosc))));
  },
  zapisz(tabela, obiekt) {
    F.setDoc(F.doc(fs, tabela, obiekt.id), obiekt).catch(bladZapisu);
    return Promise.resolve();
  },
  usun(tabela, id) {
    F.deleteDoc(F.doc(fs, tabela, id)).catch(bladZapisu);
    return Promise.resolve();
  },
};

// Zastępcza pamięć (np. Safari w trybie prywatnym, gdzie IndexedDB nie działa):
// dane żyją tylko do zamknięcia aplikacji.
const pamiec = new Map();
const tab = (t) => { if (!pamiec.has(t)) pamiec.set(t, new Map()); return pamiec.get(t); };
const lokalnaPamiec = {
  pobierz: async (t, id) => tab(t).get(id),
  wszystkie: async (t) => [...tab(t).values()],
  wgIndeksu: async (t, i, w) => [...tab(t).values()].filter((o) => o[i] === w),
  zapisz: async (t, o) => { tab(t).set(o.id, o); },
  usun: async (t, id) => { tab(t).delete(id); },
};
let lokalnaDziala = null;
async function lokalnaBaza() {
  if (lokalnaDziala === null) {
    try { await otworz(); lokalnaDziala = true; } catch (e) { lokalnaDziala = false; console.warn('IndexedDB niedostępne – pamięć tymczasowa'); }
  }
  return lokalnaDziala ? lokalnaIDB : lokalnaPamiec;
}
const lokalna = Object.fromEntries(['pobierz', 'wszystkie', 'wgIndeksu', 'zapisz', 'usun']
  .map((f) => [f, async (...a) => (await lokalnaBaza())[f](...a)]));

const wybierz = (tabela) => (WSPOLNE.includes(tabela) ? wspolna : lokalna);
export const baza = {
  pobierz: (t, id) => wybierz(t).pobierz(t, id),
  wszystkie: (t) => wybierz(t).wszystkie(t),
  wgIndeksu: (t, i, w) => wybierz(t).wgIndeksu(t, i, w),
  zapisz: (t, o) => wybierz(t).zapisz(t, o),
  usun: (t, id) => wybierz(t).usun(t, id),
};

// Unikalny identyfikator nowego wpisu.
export function noweId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Prosi przeglądarkę, żeby nie kasowała danych przy braku miejsca.
// (Na Androidzie zwykle się zgadza; na iPhonie pomaga dodanie do ekranu głównego.)
export async function poprosOTrwalyZapis() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) { /* brak obsługi – trudno */ }
  return false;
}

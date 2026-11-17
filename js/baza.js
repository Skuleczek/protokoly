// ============================================================
// baza.js – zapis danych w pamięci telefonu (IndexedDB).
// IndexedDB to baza danych wbudowana w każdą przeglądarkę.
// Dane NIE wychodzą poza telefon.
// ============================================================

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

export const baza = {
  pobierz: (tabela, id) => wykonaj(tabela, 'readonly', (t) => t.get(id)),
  wszystkie: (tabela) => wykonaj(tabela, 'readonly', (t) => t.getAll()),
  wgIndeksu: (tabela, indeks, wartosc) =>
    wykonaj(tabela, 'readonly', (t) => t.index(indeks).getAll(wartosc)),
  zapisz: (tabela, obiekt) => wykonaj(tabela, 'readwrite', (t) => t.put(obiekt)),
  usun: (tabela, id) => wykonaj(tabela, 'readwrite', (t) => t.delete(id)),
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

// ============================================================
// chmura.js – połączenie ze wspólną bazą (Firebase) i logowanie.
//
// Logowanie: urządzenie dostaje od Firebase stały, anonimowy identyfikator.
// Sam identyfikator NIE daje dostępu – dopiero przypisanie urządzenia
// do konta jednorazowym kodem od administratora (pilnują tego reguły
// w pliku firestore.rules, wykonywane na serwerze Google).
// ============================================================

import * as F from '../lib/firebase.js';
import { KONFIG_FIREBASE, WAZNOSC_KODU_GODZ } from './konfiguracja.js';

const app = F.initializeApp(KONFIG_FIREBASE);
export const auth = F.getAuth(app);
// Czy przeglądarka pozwala zapisywać dane w telefonie (IndexedDB)?
// Na iPhonie w trybie prywatnym / trybie blokady – czasem nie.
async function zapisWTelefonieDziala() {
  try {
    await new Promise((ok, nie) => {
      const z = indexedDB.open('test-zapisu');
      z.onsuccess = () => { z.result.close(); ok(); };
      z.onerror = () => nie(z.error);
      setTimeout(() => nie(new Error('czas')), 3000);
    });
    return true;
  } catch (e) { return false; }
}
export const trybPamieci = !(await zapisWTelefonieDziala());

// Pamięć podręczna w telefonie: dane są dostępne bez zasięgu,
// a zmiany zrobione offline wysyłają się same, gdy wróci internet.
// Gdy zapis w telefonie nie działa – tryb awaryjny w pamięci (wymaga internetu).
export const fs = F.initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: trybPamieci
    ? F.memoryLocalCache()
    : F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
});

// Tryb testowy na komputerze programisty (lokalny emulator Firebase).
if (['localhost', '127.0.0.1'].includes(location.hostname) && location.search.includes('emulator')) {
  F.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  F.connectFirestoreEmulator(fs, '127.0.0.1', 8180);
}

export { F };

// ------------------------------------------------------------
// Sesja: kto jest zalogowany na tym urządzeniu
// ------------------------------------------------------------
const KLUCZ_SESJI = 'sesja';
export let sesja = null; // { uid, konto, imie, admin }

function zapamietajSesje(s) {
  sesja = s;
  try { s ? localStorage.setItem(KLUCZ_SESJI, JSON.stringify(s)) : localStorage.removeItem(KLUCZ_SESJI); } catch (e) { /* trudno */ }
}
function sesjaZPamieci() {
  try { return JSON.parse(localStorage.getItem(KLUCZ_SESJI)); } catch (e) { return null; }
}

// "jan kowalski", "Jan  Kowalski" -> "jan-kowalski"
export function idKonta(imie) {
  return String(imie).trim().toLowerCase()
    .replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const opisUrzadzenia = () => (navigator.userAgent.match(/\(([^)]+)\)/) || [, 'nieznane'])[1].slice(0, 80);

function czekajNaAuth() {
  return new Promise((ok) => { const stop = F.onAuthStateChanged(auth, (u) => { stop(); ok(u); }); });
}

async function pobierzDokument(sciezka) {
  const ref = F.doc(fs, ...sciezka);
  if (!navigator.onLine) return F.getDocFromCache(ref);
  try { return await F.getDoc(ref); } catch (e) {
    if (e.code === 'permission-denied') throw e;
    return F.getDocFromCache(ref);
  }
}

/*
 Sprawdza stan logowania. Zwraca jedno z:
  { stan: 'ok' }            – można pracować (sesja ustawiona)
  { stan: 'logowanie' }     – trzeba wpisać imię i kod
  { stan: 'pierwszeKonto' } – baza pusta: zakładanie konta administratora
  { stan: 'zablokowane' }   – konto zablokowane przez administratora
  { stan: 'brakSieci' }     – pierwsze uruchomienie wymaga internetu
*/
export async function sprawdzLogowanie() {
  let uzytkownik = await czekajNaAuth();
  const zapamietana = sesjaZPamieci();

  if (!uzytkownik) {
    if (!navigator.onLine) return { stan: 'brakSieci' };
    uzytkownik = (await F.signInAnonymously(auth)).user;
  }
  // Bez internetu ufamy zapamiętanej sesji (sprawdzi ją serwer po powrocie sieci).
  if (zapamietana && zapamietana.uid === uzytkownik.uid && !navigator.onLine) {
    sesja = zapamietana;
    return { stan: 'ok' };
  }
  try {
    const urz = await pobierzDokument(['urzadzenia', uzytkownik.uid]);
    if (!urz.exists()) {
      zapamietajSesje(null);
      const zal = await pobierzDokument(['konfiguracja', 'zalozono']);
      return { stan: zal.exists() ? 'logowanie' : 'pierwszeKonto' };
    }
    const konto = await pobierzDokument(['konta', urz.data().konto]);
    const k = konto.data();
    if (!k || !k.aktywny) { zapamietajSesje(null); return { stan: 'zablokowane' }; }
    zapamietajSesje({ uid: uzytkownik.uid, konto: urz.data().konto, imie: k.imie, admin: !!k.admin });
    return { stan: 'ok' };
  } catch (e) {
    if (zapamietana && zapamietana.uid === uzytkownik.uid) { sesja = zapamietana; return { stan: 'ok' }; }
    if (e.code === 'permission-denied') return { stan: 'zablokowane' };
    return { stan: 'brakSieci' };
  }
}

// Logowanie imieniem i jednorazowym kodem.
export async function zalogujKodem(imie, kod) {
  const konto = idKonta(imie);
  const czystyKod = String(kod).replace(/\D/g, '');
  if (!auth.currentUser) await F.signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  const b = F.writeBatch(fs);
  b.set(F.doc(fs, 'urzadzenia', uid), { konto, kod: czystyKod, opis: opisUrzadzenia(), utworzono: F.serverTimestamp() });
  b.delete(F.doc(fs, 'kody', `${konto}_${czystyKod}`)); // kod zużyty w tej samej chwili
  await b.commit();
  return sprawdzLogowanie();
}

// Pierwsze uruchomienie: zakłada konto administratora.
export async function zalozPierwszeKonto(imie) {
  const konto = idKonta(imie);
  const uid = auth.currentUser.uid;
  const b = F.writeBatch(fs);
  b.set(F.doc(fs, 'konta', konto), { imie: imie.trim(), admin: true, aktywny: true, utworzono: F.serverTimestamp() });
  b.set(F.doc(fs, 'urzadzenia', uid), { konto, kod: 'start', opis: opisUrzadzenia(), utworzono: F.serverTimestamp() });
  b.set(F.doc(fs, 'konfiguracja', 'zalozono'), { kiedy: F.serverTimestamp() });
  await b.commit();
  return sprawdzLogowanie();
}

// ------------------------------------------------------------
// Administrator: osoby i kody
// ------------------------------------------------------------
export async function listaKont() {
  const [konta, urzadzenia, kody] = await Promise.all(
    ['konta', 'urzadzenia', 'kody'].map((k) => F.getDocs(F.collection(fs, k))));
  const teraz = Date.now();
  return konta.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    urzadzen: urzadzenia.docs.filter((u) => u.data().konto === d.id).length,
    kodyAktywne: kody.docs.filter((k) => k.data().konto === d.id && k.data().wazneDo.toMillis() > teraz)
      .map((k) => ({ kod: k.id.split('_').pop(), wazneDo: k.data().wazneDo.toDate() })),
  })).sort((a, b) => a.imie.localeCompare(b.imie, 'pl'));
}

export async function dodajKonto(imie) {
  const id = idKonta(imie);
  if (!id) throw new Error('Wpisz imię.');
  const istnieje = await F.getDoc(F.doc(fs, 'konta', id));
  if (istnieje.exists()) throw new Error(`Osoba „${istnieje.data().imie}” już istnieje. Wygeneruj jej nowy kod.`);
  await F.setDoc(F.doc(fs, 'konta', id), { imie: imie.trim(), admin: false, aktywny: true, utworzono: F.serverTimestamp() });
  return id;
}

export async function nowyKod(kontoId) {
  const liczby = new Uint32Array(1);
  crypto.getRandomValues(liczby);
  const kod = String(liczby[0] % 1000000).padStart(6, '0');
  const wazneDo = F.Timestamp.fromMillis(Date.now() + WAZNOSC_KODU_GODZ * 3600 * 1000);
  await F.setDoc(F.doc(fs, 'kody', `${kontoId}_${kod}`), { konto: kontoId, wazneDo, utworzono: F.serverTimestamp() });
  return { kod, wazneDo: wazneDo.toDate() };
}

export async function ustawAktywne(kontoId, aktywny) {
  const ref = F.doc(fs, 'konta', kontoId);
  const d = (await F.getDoc(ref)).data();
  await F.setDoc(ref, { ...d, aktywny });
}

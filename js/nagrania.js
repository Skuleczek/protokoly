// ============================================================
// nagrania.js – nagrywanie głosu, kolejka i transkrypcja (OpenAI).
//
// 1. Nagranie zapisuje się NAJPIERW w telefonie (kolejka w IndexedDB).
// 2. Gdy jest internet – idzie do transkrypcji. Bez zasięgu czeka
//    i wysyła się samo, gdy sieć wróci.
// 3. Po udanej transkrypcji nagranie jest USUWANE z telefonu.
// ============================================================

import { baza, noweId } from './baza.js';
import { fs, F, sesja } from './chmura.js';

const ADRES_OPENAI = 'https://api.openai.com/v1';
export const MODEL_DOMYSLNY = 'gpt-transcribe';
const MODEL_ZAPASOWY = 'gpt-4o-transcribe';

// ------------------------------------------------------------
// Ustawienia: klucze (wspólne, od administratora) i tryb testowy (lokalny)
// ------------------------------------------------------------
let kluczeCache = null;
export async function pobierzKlucze(odswiez = false) {
  if (kluczeCache && !odswiez) return kluczeCache;
  const ref = F.doc(fs, 'sekrety', 'klucze');
  let d = null;
  try { d = navigator.onLine ? await F.getDoc(ref) : await F.getDocFromCache(ref); } catch (e) {
    try { d = await F.getDocFromCache(ref); } catch (e2) { d = null; }
  }
  kluczeCache = (d && d.exists() && d.data()) || {};
  return kluczeCache;
}
export async function zapiszKlucze(zmiany) {
  const obecne = await pobierzKlucze(true);
  const nowe = { ...obecne, ...zmiany };
  await F.setDoc(F.doc(fs, 'sekrety', 'klucze'), nowe);
  kluczeCache = nowe;
}

export function trybTestowy() {
  try { return localStorage.getItem('trybTestowy') === '1'; } catch (e) { return false; }
}
export function ustawTrybTestowy(wl) {
  try { localStorage.setItem('trybTestowy', wl ? '1' : '0'); } catch (e) { /* trudno */ }
}

let slownikCache = null;
export async function wczytajSlownik() {
  if (!slownikCache) {
    try { slownikCache = await (await fetch('dane/slownik-startowy.json')).json(); } catch (e) { slownikCache = []; }
  }
  return slownikCache;
}
async function podpowiedzSlownika() {
  await wczytajSlownik();
  return `Protokół kontroli centrali wentylacyjnej, serwis wentylacji. Terminy: ${slownikCache.join(', ')}.`.slice(0, 900);
}

// ------------------------------------------------------------
// Nagrywanie
// ------------------------------------------------------------
function wybierzFormat() {
  const formaty = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (!window.MediaRecorder) return null;
  return formaty.find((f) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(f)) || '';
}

export class Nagrywarka {
  async start() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      throw new Error('Ta przeglądarka nie obsługuje nagrywania. Użyj Chrome (Android) lub Safari (iPhone).');
    }
    this.strumien = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const format = wybierzFormat();
    this.rejestrator = new MediaRecorder(this.strumien, { ...(format ? { mimeType: format } : {}), audioBitsPerSecond: 32000 });
    this.kawalki = [];
    this.rejestrator.ondataavailable = (e) => { if (e.data && e.data.size) this.kawalki.push(e.data); };
    this.rejestrator.start(1000);
    this.poczatek = Date.now();
    // Nie wygaszaj ekranu w trakcie nagrania (na niektórych telefonach wygaszenie przerywa nagranie).
    try { this.blokadaEkranu = await navigator.wakeLock.request('screen'); } catch (e) { /* brak obsługi */ }
  }

  sekundy() { return this.poczatek ? (Date.now() - this.poczatek) / 1000 : 0; }

  async stop() {
    const sekundy = this.sekundy();
    await new Promise((ok) => { this.rejestrator.onstop = ok; this.rejestrator.stop(); });
    this.strumien.getTracks().forEach((t) => t.stop());
    try { if (this.blokadaEkranu) await this.blokadaEkranu.release(); } catch (e) { /* trudno */ }
    const typ = this.rejestrator.mimeType || (this.kawalki[0] && this.kawalki[0].type) || 'audio/webm';
    return { blob: new Blob(this.kawalki, { type: typ }), sekundy };
  }

  anuluj() {
    try { this.rejestrator.stop(); } catch (e) { /* już zatrzymany */ }
    if (this.strumien) this.strumien.getTracks().forEach((t) => t.stop());
    try { if (this.blokadaEkranu) this.blokadaEkranu.release(); } catch (e) { /* trudno */ }
  }
}

// ------------------------------------------------------------
// Kolejka nagrań (w telefonie)
// ------------------------------------------------------------
/* Wpis w kolejce: { id, protokolId, typ, dane (ArrayBuffer), sekundy, utworzono,
                     status: 'czeka' | 'wysylanie' | 'blad', blad, proby } */
export async function dodajDoKolejki(protokolId, { blob, sekundy }) {
  const wpis = {
    id: noweId(), protokolId, typ: blob.type, dane: await blob.arrayBuffer(), sekundy,
    utworzono: Date.now(), status: 'czeka', blad: null, proby: 0,
  };
  await baza.zapisz('nagrania', wpis);
  return wpis;
}

export async function nagraniaProtokolu(protokolId) {
  return (await baza.wgIndeksu('nagrania', 'protokolId', protokolId)).sort((a, b) => a.utworzono - b.utworzono);
}
export const usunNagranie = (id) => baza.usun('nagrania', id);

// Rozszerzenie pliku dla OpenAI na podstawie typu nagrania.
function nazwaPliku(typ) {
  if (typ.includes('mp4') || typ.includes('m4a') || typ.includes('aac')) return 'nagranie.mp4';
  if (typ.includes('ogg')) return 'nagranie.ogg';
  if (typ.includes('wav')) return 'nagranie.wav';
  return 'nagranie.webm';
}

class BladTranskrypcji extends Error {
  constructor(komunikat, { ponawiaj = true } = {}) { super(komunikat); this.ponawiaj = ponawiaj; }
}

async function wyslijDoOpenAI(wpis, klucz, model) {
  const formularz = new FormData();
  formularz.append('file', new Blob([wpis.dane], { type: wpis.typ }), nazwaPliku(wpis.typ));
  formularz.append('model', model);
  formularz.append('language', 'pl');
  formularz.append('prompt', await podpowiedzSlownika());
  formularz.append('response_format', 'json');
  let odp;
  try {
    odp = await fetch(`${ADRES_OPENAI}/audio/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${klucz}` }, body: formularz,
    });
  } catch (e) {
    throw new BladTranskrypcji('Brak połączenia z OpenAI – spróbuję ponownie.');
  }
  if (odp.ok) return (await odp.json()).text || '';
  let szczegoly = '';
  try { szczegoly = ((await odp.json()).error || {}).message || ''; } catch (e) { /* brak treści */ }
  if (odp.status === 401) throw new BladTranskrypcji('Klucz OpenAI jest nieprawidłowy albo wygasł – administrator musi wpisać nowy w Ustawieniach.', { ponawiaj: false });
  if (odp.status === 429) throw new BladTranskrypcji(/quota|billing|credit/i.test(szczegoly) ? 'Brak środków na koncie OpenAI – trzeba doładować.' : 'OpenAI: za dużo zapytań – spróbuję za chwilę.', { ponawiaj: !/quota|billing|credit/i.test(szczegoly) });
  if (odp.status === 400 || odp.status === 404) {
    const e = new BladTranskrypcji(`OpenAI odrzuciło nagranie: ${szczegoly || odp.status}`, { ponawiaj: false });
    e.model = /model/i.test(szczegoly);
    throw e;
  }
  throw new BladTranskrypcji(`Błąd serwera OpenAI (${odp.status}) – spróbuję ponownie.`);
}

async function transkrybuj(wpis) {
  if (trybTestowy()) {
    await new Promise((ok) => setTimeout(ok, 1200));
    return { tekst: 'TRYB TESTOWY: Sekcja wentylatora nawiewnego sprawna, ale łożyska do wymiany, rozmiar 6205. Pobór prądu 3,2 ampera, znamionowy 4,1. Wywiew sprawny. Nagrzewnicy elektrycznej brak. Filtry wstępne wymienione. Następny przegląd maj 2027.', model: 'test' };
  }
  const klucze = await pobierzKlucze();
  if (!klucze.openai) throw new BladTranskrypcji('Brak klucza OpenAI – administrator musi go wpisać w Ustawieniach.', { ponawiaj: false });
  const model = klucze.modelTranskrypcji || MODEL_DOMYSLNY;
  try {
    return { tekst: await wyslijDoOpenAI(wpis, klucze.openai, model), model };
  } catch (e) {
    // Gdy OpenAI nie zna modelu – próbujemy modelu zapasowego.
    if (e.model && model !== MODEL_ZAPASOWY) {
      return { tekst: await wyslijDoOpenAI(wpis, klucze.openai, MODEL_ZAPASOWY), model: MODEL_ZAPASOWY };
    }
    throw e;
  }
}

// Zapis zużycia (do panelu kosztów administratora).
export function zapiszZuzycie(dane) {
  if (!sesja) return;
  const teraz = new Date();
  const miesiac = `${teraz.getFullYear()}-${String(teraz.getMonth() + 1).padStart(2, '0')}`;
  F.setDoc(F.doc(fs, 'zuzycie', noweId()), {
    konto: sesja.konto, imie: sesja.imie, miesiac, kiedy: F.serverTimestamp(), ...dane,
  }).catch((e) => console.error(e));
}

// ------------------------------------------------------------
// Przetwarzanie kolejki
// ------------------------------------------------------------
let trwa = false;
let sluchacze = [];
export function przyZmianieKolejki(fn) { sluchacze.push(fn); }
const powiadom = (zdarzenie) => sluchacze.forEach((fn) => { try { fn(zdarzenie); } catch (e) { console.error(e); } });

/**
 * Przetwarza wszystkie czekające nagrania.
 * @param {(protokolId, wpis) => Promise<void>} zapiszTranskrypcje – dopisuje tekst do protokołu
 */
export async function przetworzKolejke(zapiszTranskrypcje, { tezBledy = false } = {}) {
  if (trwa || (!navigator.onLine && !trybTestowy())) return;
  trwa = true;
  try {
    const wszystkie = (await baza.wszystkie('nagrania')).sort((a, b) => a.utworzono - b.utworzono);
    for (const wpis of wszystkie) {
      if (wpis.status === 'blad' && !tezBledy && !wpis.ponawiaj) continue;
      if (!navigator.onLine && !trybTestowy()) break;
      wpis.status = 'wysylanie'; wpis.proby = (wpis.proby || 0) + 1;
      await baza.zapisz('nagrania', wpis);
      powiadom({ protokolId: wpis.protokolId });
      try {
        const { tekst, model } = await transkrybuj(wpis);
        await zapiszTranskrypcje(wpis.protokolId, {
          id: wpis.id, tekst: tekst.trim(), sekundy: Math.round(wpis.sekundy), kiedy: Date.now(),
          konto: sesja ? sesja.konto : '', imie: sesja ? sesja.imie : '', ai: 'czeka',
        });
        if (model !== 'test') zapiszZuzycie({ rodzaj: 'transkrypcja', model, sekundy: Math.round(wpis.sekundy) });
        await usunNagranie(wpis.id); // nagranie niepotrzebne – usuwamy z telefonu
      } catch (e) {
        console.error(e);
        wpis.status = 'blad';
        wpis.blad = e.message;
        wpis.ponawiaj = e.ponawiaj !== false;
        await baza.zapisz('nagrania', wpis);
        if (wpis.ponawiaj === false) { powiadom({ protokolId: wpis.protokolId }); break; } // np. zły klucz – nie męcz reszty
      }
      powiadom({ protokolId: wpis.protokolId });
    }
  } finally {
    trwa = false;
  }
}

export async function ileWKolejce() {
  return (await baza.wszystkie('nagrania')).length;
}

// Sprawdza klucz OpenAI i dostępność modelu (bez kosztów).
export async function sprawdzKluczOpenAI(klucz, model) {
  try {
    const odp = await fetch(`${ADRES_OPENAI}/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${klucz}` } });
    if (odp.ok) return { ok: true, tekst: `✓ Klucz działa, model „${model}” jest dostępny.` };
    if (odp.status === 401) return { ok: false, tekst: '✗ Klucz nieprawidłowy albo wygasł.' };
    if (odp.status === 404) return { ok: false, tekst: `✗ Klucz działa, ale model „${model}” nie istnieje. Spróbuj „${MODEL_ZAPASOWY}”.` };
    return { ok: false, tekst: `✗ OpenAI odpowiedziało błędem ${odp.status}.` };
  } catch (e) {
    return { ok: false, tekst: '✗ Brak połączenia z OpenAI.' };
  }
}

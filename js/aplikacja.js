// ============================================================
// aplikacja.js – ekrany aplikacji.
// Adres po znaku # mówi, który ekran pokazać:
//   #/                      – lista grup (klientów)
//   #/grupa/ID              – przeglądy w grupie
//   #/przeglad/ID           – centrale w przeglądzie
//   #/protokol/ID           – formularz protokołu
//   #/uzytkownicy           – osoby i kody (tylko administrator)
//   #/pdf/przeglad/ID, #/pdf/grupa/ID – wybór protokołów do PDF
//   #/zdjecia               – zdjęcia -> jeden plik PDF
//   #/ustawienia            – tryb testowy (dla wszystkich)
//   #/administrator, #/klucze, #/koszty, #/slownik, #/kopia, #/testai – ekrany administratora
// ============================================================

import { baza, noweId, poprosOTrwalyZapis, przyBledzieZapisu } from './baza.js';
import * as P from './protokol.js';
import * as C from './chmura.js';
import * as N from './nagrania.js';
import * as AI from './ai.js';
import * as K from './koszty.js';

const ekran = document.getElementById('app');

// Zabezpiecza tekst wpisany przez użytkownika przed wstawieniem do HTML.
const h = (t) => String(t ?? '').replace(/[&<>"']/g, (z) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));

const idzDo = (adres) => { location.hash = adres; };

function pokazKomunikat(tekst) {
  const el = document.getElementById('komunikat');
  el.textContent = tekst;
  el.classList.add('widoczny');
  clearTimeout(pokazKomunikat.t);
  pokazKomunikat.t = setTimeout(() => el.classList.remove('widoczny'), 2200);
}

// ------------------------------------------------------------
// Uprawnienia (te same zasady pilnuje serwer w firestore.rules)
// ------------------------------------------------------------
const jestAdminem = () => !!(C.sesja && C.sesja.admin);
const mozeUsunacProtokol = (p) => jestAdminem() || (C.sesja && p.autor === C.sesja.konto);

// Ile dni zostało do daty "RRRR-MM-DD" (ujemne = po terminie).
function dniDo(dataIso) {
  if (!dataIso) return null;
  const [r, m, d] = dataIso.split('-').map(Number);
  const cel = new Date(r, m - 1, d);
  const dzis = new Date(); dzis.setHours(0, 0, 0, 0);
  return Math.round((cel - dzis) / 86400000);
}
function opisWaznosci(dataIso) {
  const dni = dniDo(dataIso);
  if (dni === null) return '';
  if (dni < 0) return `<b class="czerwony">⛔ wygasł ${-dni} dni temu</b>`;
  if (dni <= 14) return `<b class="pomaranczowy">⚠ wygasa za ${dni} dni</b>`;
  return `pozostało ${dni} dni`;
}
// "za ile dni" -> data "RRRR-MM-DD" (puste = nie wygasa).
function zaDni(ileDni) {
  const n = parseInt(ileDni, 10);
  if (!Number.isFinite(n) || String(ileDni).trim() === '') return '';
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Pole w Ustawieniach pokazuje, ile dni zostało (ujemne = po terminie -> 0).
const pozostaloDni = (dataIso) => (dataIso ? Math.max(0, dniDo(dataIso)) : '');

function godzinaPL(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ------------------------------------------------------------
// Pomocnicze odczyty z bazy
// ------------------------------------------------------------
const sortujPrzeglady = (lista) => lista.sort((a, b) => b.data.localeCompare(a.data) || b.utworzono - a.utworzono);
const sortujProtokoly = (lista) => lista.sort((a, b) => a.utworzono - b.utworzono);

async function protokolyPrzegladu(przegladId) {
  return sortujProtokoly(await baza.wgIndeksu('protokoly', 'przegladId', przegladId));
}

// Centrale z wcześniejszych przeglądów tej grupy, których jeszcze nie ma w bieżącym przeglądzie.
async function kandydaciDoKopii(przeglad) {
  const przeglady = sortujPrzeglady(await baza.wgIndeksu('przeglady', 'grupaId', przeglad.grupaId))
    .filter((x) => x.id !== przeglad.id && x.data <= przeglad.data);
  const obecne = await protokolyPrzegladu(przeglad.id);
  const wynik = [];
  for (const pg of przeglady) {
    for (const pr of await protokolyPrzegladu(pg.id)) {
      const juzJest = [...obecne, ...wynik.map((w) => w.protokol)].some((o) => P.tenSamUrzadzenie(o, pr));
      const pusty = !Object.values(pr.naglowek).some((v) => String(v).trim());
      if (!juzJest && !pusty) wynik.push({ protokol: pr, przeglad: pg });
    }
  }
  return wynik;
}

// ------------------------------------------------------------
// EKRAN: lista grup
// ------------------------------------------------------------
async function ekranGrupy() {
  const grupy = (await baza.wszystkie('grupy')).sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'));
  const protokoly = await baza.wszystkie('protokoly');
  const ile = (id) => protokoly.filter((p) => p.grupaId === id).length;

  ekran.innerHTML = `
    <header class="pasek"><h1>Protokoły</h1></header>
    <main>
      <div class="kto">👤 ${h(C.sesja.imie)}${jestAdminem() ? ' · administrator' : ''}</div>
      <button class="duzy glowny" data-akcja="nowaGrupa">＋ Nowa grupa (klient)</button>
      <a class="duzy przycisk-link" href="#/zdjecia">🖼 Zdjęcia → PDF</a>
      <div id="stanKolejki"></div>
      <div id="ostrzezeniaKluczy"></div>
      ${grupy.length ? '' : '<p class="pusto">Nie masz jeszcze żadnej grupy. Dodaj pierwszego klienta.</p>'}
      <ul class="lista">
        ${grupy.map((g) => `
          <li><a class="wiersz" href="#/grupa/${g.id}">
            <span class="tytul">📁 ${h(g.nazwa)}</span>
            <span class="opis">${ile(g.id)} protokołów</span>
          </a></li>`).join('')}
      </ul>
      <div class="opcje">
        <a class="sredni przycisk-link" href="#/ustawienia">⚙ Ustawienia</a>
        ${jestAdminem() ? '<a class="sredni przycisk-link" href="#/administrator">🛠 Administrator</a>' : ''}
      </div>
    </main>`;
}

// ------------------------------------------------------------
// EKRAN: grupa -> lista przeglądów
// ------------------------------------------------------------
async function ekranGrupa(id) {
  const grupa = await baza.pobierz('grupy', id);
  if (!grupa) return idzDo('#/');
  const przeglady = sortujPrzeglady(await baza.wgIndeksu('przeglady', 'grupaId', id));
  const protokoly = await baza.wgIndeksu('protokoly', 'grupaId', id);
  const ile = (pid) => protokoly.filter((p) => p.przegladId === pid).length;

  ekran.innerHTML = `
    <header class="pasek">
      <a class="wstecz" href="#/">‹</a>
      <h1>${h(grupa.nazwa)}</h1>
    </header>
    <main>
      <button class="duzy glowny" data-akcja="nowyPrzeglad" data-id="${id}">＋ Nowy przegląd (dziś)</button>
      ${przeglady.length ? '' : '<p class="pusto">Brak przeglądów w tej grupie.</p>'}
      <ul class="lista">
        ${przeglady.map((pg) => `
          <li><a class="wiersz" href="#/przeglad/${pg.id}">
            <span class="tytul">📅 Przegląd ${P.dataPL(pg.data)}</span>
            <span class="opis">${ile(pg.id)} central</span>
          </a></li>`).join('')}
      </ul>
      <div class="opcje">
        ${protokoly.length ? `<a class="sredni przycisk-link" href="#/pdf/grupa/${id}">📄 PDF z całej grupy</a>` : ''}
        <button class="sredni" data-akcja="zmienNazweGrupy" data-id="${id}">✎ Zmień nazwę grupy</button>
        ${jestAdminem() ? `<button class="sredni niebezpieczny" data-akcja="usunGrupe" data-id="${id}">🗑 Usuń grupę</button>` : ''}
      </div>
    </main>`;
}

// ------------------------------------------------------------
// EKRAN: przegląd -> lista central
// ------------------------------------------------------------
async function ekranPrzeglad(id) {
  const przeglad = await baza.pobierz('przeglady', id);
  if (!przeglad) return idzDo('#/');
  const grupa = await baza.pobierz('grupy', przeglad.grupaId);
  const protokoly = await protokolyPrzegladu(id);
  const kandydaci = await kandydaciDoKopii(przeglad);

  ekran.innerHTML = `
    <header class="pasek">
      <a class="wstecz" href="#/grupa/${przeglad.grupaId}">‹</a>
      <h1>${h(grupa.nazwa)}</h1>
    </header>
    <main>
      <label class="pole">Data przeglądu
        <input type="date" value="${przeglad.data}" data-akcja="dataPrzegladu" data-id="${id}">
      </label>
      <button class="duzy glowny" data-akcja="nowaCentrala" data-id="${id}">＋ Nowa centrala</button>
      ${kandydaci.length ? `<button class="duzy" data-akcja="pokazKandydatow">↺ Centrala z poprzedniego przeglądu (${kandydaci.length})</button>
        <ul class="lista ukryta" id="kandydaci">
          ${kandydaci.map((k) => `<li><button class="wiersz" data-akcja="kopiujCentrale" data-id="${id}" data-zrodlo="${k.protokol.id}">
            <span class="tytul">${h(P.opisCentrali(k.protokol))}</span>
            <span class="opis">nr fabr. ${h(k.protokol.naglowek.nrFabr || '–')} · z przeglądu ${P.dataPL(k.przeglad.data)}</span>
          </button></li>`).join('')}
        </ul>` : ''}
      ${protokoly.length ? `<h2>Centrale (${protokoly.length})</h2>` : '<p class="pusto">Brak central w tym przeglądzie.</p>'}
      <ul class="lista">
        ${protokoly.map((p, i) => {
          const st = P.postep(p);
          const plakietka = st.gotowy ? '<span class="plakietka ok">✓ gotowy</span>'
            : `<span class="plakietka brak">${st.brakuje ? `brakuje ${st.brakuje}` : ''}${st.flagi ? ` ⚠ ${st.flagi}` : ''}</span>`;
          return `<li class="z-koszem"><a class="wiersz" href="#/protokol/${p.id}">
            <span class="tytul">${i + 1}. ${h(P.opisCentrali(p))}</span>
            <span class="opis">nr fabr. ${h(p.naglowek.nrFabr || '–')} ${plakietka}</span>
            <span class="opis">👤 ${h(p.autorImie || '–')}${p.zmienilImie && p.zmienil !== p.autor ? ` · edytował: ${h(p.zmienilImie)}` : ''}</span>
          </a>${mozeUsunacProtokol(p) ? `<button class="kosz" data-akcja="usunZListy" data-id="${p.id}" aria-label="Usuń protokół">🗑</button>` : ''}</li>`;
        }).join('')}
      </ul>
      <div class="opcje">
        ${protokoly.length ? `<a class="sredni przycisk-link" href="#/pdf/przeglad/${id}">📄 PDF przeglądu</a>` : ''}
        ${jestAdminem() ? `<button class="sredni niebezpieczny" data-akcja="usunPrzeglad" data-id="${id}">🗑 Usuń przegląd</button>` : ''}
      </div>
    </main>`;
}

// ------------------------------------------------------------
// EKRAN: formularz protokołu
// ------------------------------------------------------------
let biezacy = null;        // protokół otwarty w formularzu
let czasomierzZapisu = null;

function zapiszZaChwile() {
  if (biezacy) biezacy.niezapisane = true;
  clearTimeout(czasomierzZapisu);
  czasomierzZapisu = setTimeout(zapiszTeraz, 1500);
}
async function zapiszTeraz() {
  clearTimeout(czasomierzZapisu);
  if (!biezacy || !biezacy.niezapisane) return;
  biezacy.niezapisane = false;
  biezacy.zmieniono = Date.now();
  biezacy.zmienil = C.sesja.konto;
  biezacy.zmienilImie = C.sesja.imie;
  const { niezapisane, ...doZapisu } = biezacy;
  await baza.zapisz('protokoly', doZapisu);
}

// Pola zmienione przez AI (wyróżniane do czasu „Zatwierdź”) – tylko w aplikacji, nie w PDF.
function zmienioneAI(p) {
  return new Set(p.ostatnieAI && !p.ostatnieAI.zatwierdzone ? p.ostatnieAI.zmienione : []);
}
const znakAI = '<span class="znak-ai">🤖 AI</span>';

function htmlFlagi(p, klucz) {
  const f = p.flagi && p.flagi[klucz];
  if (!f) return '';
  const nazwa = f.typ === 'uzupelnij' ? 'Do uzupełnienia' : 'Do sprawdzenia';
  return `<div class="flaga flaga-z-ok"><span>⚠ ${nazwa}${f.cytat ? `: „${h(f.cytat)}”` : ''}</span>
    <button class="ok-flagi" data-akcja="usunFlage" data-klucz="${h(klucz)}" aria-label="Sprawdzone">✓ OK</button></div>`;
}

function htmlPunkt(p, pkt) {
  const w = p.punkty[pkt.nr] || {};
  const flagaPunktu = htmlFlagi(p, pkt.nr);
  if (pkt.typ === 'liczby') {
    const ai = pkt.pola.some((pl) => zmienioneAI(p).has(`${pkt.nr}.${pl.id}`));
    return `<div class="punkt ${ai ? 'ai' : ''}">
      <div class="punkt-nazwa"><b>${pkt.nr}.</b> ${h(pkt.nazwa)}${ai ? znakAI : ''}</div>
      <div class="liczby">
        ${pkt.pola.map((pole) => `<label class="pole maly ${!pole.opcjonalne && !String(w[pole.id] ?? '').trim() ? 'puste' : ''}">${h(pole.etykieta)}${pole.opcjonalne ? ' <span class="opcjonalny">(opcjonalnie)</span>' : ''}
          <input type="text" inputmode="decimal" value="${h(w[pole.id] ?? '')}" data-pole="${pole.id}" data-nr="${pkt.nr}" ${pole.opcjonalne ? 'data-opcjonalne="1"' : ''}>
          ${htmlFlagi(p, `${pkt.nr}.${pole.id}`)}
        </label>`).join('')}
      </div>${flagaPunktu}
    </div>`;
  }
  const d = pkt.dodatkowe;
  let dodatkowe = '';
  if (d && d.typ === 'zaznacz') {
    dodatkowe = `<button class="wybor dod ${w.dod ? 'wybrany' : ''}" data-akcja="dodatkowe" data-nr="${pkt.nr}">${w.dod ? '☑' : '☐'} ${h(d.etykieta)}</button>`;
  } else if (d && d.typ === 'wartosc') {
    dodatkowe = `<label class="pole maly nastawa">${h(d.etykieta)}
      <input type="text" inputmode="decimal" value="${h(typeof w.dod === 'string' ? w.dod : '')}" data-pole="dod" data-nr="${pkt.nr}">
      ${htmlFlagi(p, `${pkt.nr}.dod`)}
    </label>`;
  }
  const tekstowe = (pkt.polaTekstowe || []).map((pole) => `<label class="pole maly nastawa">${h(pole.etykieta)}
      <input type="text" value="${h(w[pole.id] ?? '')}" data-pole="${pole.id}" data-nr="${pkt.nr}">
      ${htmlFlagi(p, `${pkt.nr}.${pole.id}`)}
    </label>`).join('');
  const pusty = !w.stan && !pkt.opcjonalny;
  const ai = zmienioneAI(p).has(pkt.nr) || zmienioneAI(p).has(`${pkt.nr}.dod`);
  return `<div class="punkt ${pusty ? 'pusty' : ''} ${ai ? 'ai' : ''}" data-punkt="${pkt.nr}">
    <div class="punkt-nazwa"><b>${pkt.nr}.</b> ${h(pkt.nazwa)}${pkt.opcjonalny ? ' <span class="opcjonalny">(opcjonalnie)</span>' : ''}${ai ? znakAI : ''}</div>
    <div class="rzad">
      <button class="wybor poz ${w.stan === 'poz' ? 'wybrany' : ''}" data-akcja="punkt" data-nr="${pkt.nr}" data-stan="poz">${h(pkt.pozytywna)}</button>
      <button class="wybor neg ${w.stan === 'neg' ? 'wybrany' : ''}" data-akcja="punkt" data-nr="${pkt.nr}" data-stan="neg">${h(pkt.negatywna)}</button>
    </div>
    ${dodatkowe}${tekstowe}${flagaPunktu}
  </div>`;
}

function htmlSekcja(p, s) {
  const stan = p.sekcje[s.nr] || null;
  const ai = zmienioneAI(p).has(s.nr);
  return `<section class="sekcja ${stan ? 'stan-' + stan : 'stan-pusty'}" id="sekcja-${s.nr}">
    <h3><span class="nr">${s.nr}.</span> ${h(s.nazwa)}${ai ? znakAI : ''}</h3>
    ${htmlFlagi(p, s.nr)}
    <div class="rzad">
      <button class="wybor ok-sekcja" data-akcja="sekcjaOK" data-nr="${s.nr}">✓ Sekcja OK</button>
      <button class="wybor poz ${stan === 'jest' ? 'wybrany' : ''}" data-akcja="sekcja" data-nr="${s.nr}" data-wartosc="jest">jest</button>
      <button class="wybor brak ${stan === 'brak' ? 'wybrany' : ''}" data-akcja="sekcja" data-nr="${s.nr}" data-wartosc="brak">brak</button>
    </div>
    ${stan === 'brak' ? '<p class="info">Sekcji brak – podpunkty zostają puste.</p>'
      : s.punkty.map((pkt) => htmlPunkt(p, pkt)).join('')}
  </section>`;
}

function odswiezSekcje(nrSekcji) {
  const s = P.znajdzSekcje(nrSekcji);
  const el = document.getElementById(`sekcja-${nrSekcji}`);
  if (el) el.outerHTML = htmlSekcja(biezacy, s);
  odswiezLicznik();
}

// Odświeża tylko przyciski punktu (bez przerysowania – żeby nie zamknąć klawiatury).
function odswiezPrzyciskiPunktu(nr) {
  const w = biezacy.punkty[nr] || {};
  const div = document.querySelector(`[data-punkt="${nr}"]`);
  div.querySelectorAll('[data-akcja=punkt]').forEach((b) => b.classList.toggle('wybrany', b.dataset.stan === w.stan));
  const nrS = nr.split('.')[0];
  const sek = document.getElementById(`sekcja-${nrS}`);
  const stan = biezacy.sekcje[nrS];
  sek.className = `sekcja ${stan ? 'stan-' + stan : 'stan-pusty'}`;
  sek.querySelectorAll('[data-akcja=sekcja]').forEach((b) => b.classList.toggle('wybrany', b.dataset.wartosc === stan));
}

function odswiezLicznik() {
  const el = document.getElementById('licznik');
  if (!el) return;
  const st = P.postep(biezacy);
  el.textContent = st.gotowy ? '✓ komplet' : `brakuje: ${st.brakuje}${st.flagi ? ` · ⚠ ${st.flagi}` : ''}`;
  el.className = st.gotowy ? 'licznik ok' : 'licznik';
}

async function ekranProtokol(id, gotowy = null) {
  const p = gotowy || await baza.pobierz('protokoly', id);
  if (!p) return idzDo('#/');
  biezacy = p;
  const przeglad = await baza.pobierz('przeglady', p.przegladId);
  const grupa = await baza.pobierz('grupy', p.grupaId);
  const wszystkie = await protokolyPrzegladu(p.przegladId);
  const numer = wszystkie.findIndex((x) => x.id === p.id) + 1;
  const poprzedni = wszystkie[numer - 2];
  const szablon = P.pobierzSzablon();
  const naglowekPusty = !Object.values(p.naglowek).some((v) => String(v).trim());
  const kandydaci = naglowekPusty ? await kandydaciDoKopii(przeglad) : [];

  const pole = (klucz, etykieta, tryb = 'text') => `<label class="pole ${zmienioneAI(p).has('naglowek.' + klucz) ? 'ai' : ''}">${h(etykieta)}${zmienioneAI(p).has('naglowek.' + klucz) ? znakAI : ''}
      <input type="text" ${tryb === 'liczba' ? 'inputmode="numeric"' : ''} value="${h(p.naglowek[klucz])}" data-naglowek="${klucz}">
      ${htmlFlagi(p, 'naglowek.' + klucz)}
    </label>`;

  ekran.innerHTML = `
    <header class="pasek">
      <a class="wstecz" href="#/przeglad/${p.przegladId}">‹</a>
      <h1>Centrala ${numer}/${wszystkie.length}</h1>
      <button id="licznik" class="licznik" data-akcja="doBraku"></button>
    </header>
    <main class="formularz ${p.zapisany ? 'pokaz-braki' : ''}">
      ${kandydaci.length ? `<div class="karta podpowiedz">
        <b>Ta sama centrala co w poprzednim przeglądzie?</b> Dotknij, aby skopiować typ, nr fabr., rok i oznaczenie:
        ${kandydaci.slice(0, 8).map((k) => `<button class="wiersz" data-akcja="wezNaglowek" data-zrodlo="${k.protokol.id}">
          <span class="tytul">${h(P.opisCentrali(k.protokol))}</span>
          <span class="opis">nr fabr. ${h(k.protokol.naglowek.nrFabr || '–')} · ${P.dataPL(k.przeglad.data)}</span></button>`).join('')}
      </div>` : ''}

      <p class="autor">👤 Utworzył: <b>${h(p.autorImie || '–')}</b>${p.zmienilImie && p.zmieniono ? ` · edytował: <b>${h(p.zmienilImie)}</b>, ${godzinaPL(p.zmieniono)}` : ''}</p>
      <div id="nagrania"></div>
      <section class="karta">
        ${pole('typ', 'TYP CENTRALI')}
        ${pole('nrFabr', 'NR. FABR.')}
        ${pole('rok', 'ROK PRODUKCJI', 'liczba')}
        <label class="pole">OBIEKT <input type="text" value="${h(grupa.nazwa)}" disabled></label>
        ${pole('oznaczenie', 'OZNACZENIE')}
      </section>

      ${poprzedni ? `<button class="sredni" data-akcja="budowaJakPoprzednia" data-zrodlo="${poprzedni.id}">⧉ Sekcje (jest/brak) jak w poprzedniej centrali</button>` : ''}

      ${szablon.sekcje.map((s) => htmlSekcja(p, s)).join('')}

      <section class="karta">
        <label class="pole">Data kontroli
          <input type="date" value="${h(p.dataKontroli || przeglad.data)}" data-pole-glowne="dataKontroli">
        </label>
        <label class="pole ${zmienioneAI(p).has('termin') ? 'ai' : ''}">${h(szablon.stopka.terminPrzegladu)}${zmienioneAI(p).has('termin') ? znakAI : ''}
          <input type="text" value="${h(p.termin)}" placeholder="np. 05.2027" data-pole-glowne="termin">
          ${htmlFlagi(p, 'termin')}
        </label>
        <label class="pole ${zmienioneAI(p).has('uwagi') ? 'ai' : ''}">${h(szablon.stopka.uwagi)}${zmienioneAI(p).has('uwagi') ? znakAI : ''}
          <textarea rows="4" data-pole-glowne="uwagi">${h(p.uwagi)}</textarea>
          ${htmlFlagi(p, 'uwagi')}
        </label>
      </section>

      <button class="sredni" data-akcja="pdfProtokolu">📄 PDF tego protokołu</button>
      ${mozeUsunacProtokol(p) ? '<button class="sredni niebezpieczny" data-akcja="usunProtokol">🗑 Usuń ten protokół</button>' : ''}
    </main>
    <footer class="dolny trzy">
      <button class="duzy" data-akcja="doListy" aria-label="Lista">☰</button>
      <button class="duzy mikrofon" data-akcja="nagraj" aria-label="Nagraj">🎤</button>
      <button class="duzy glowny" data-akcja="nastepna">Zapisz i następna ➜</button>
    </footer>`;
  odswiezLicznik();
  odswiezNagrania();
}

// ------------------------------------------------------------
// NAGRANIA w protokole
// ------------------------------------------------------------
async function odswiezNagrania() {
  const el = document.getElementById('nagrania');
  if (!el || !biezacy) return;
  const kolejka = await N.nagraniaProtokolu(biezacy.id);
  const gotowe = biezacy.transkrypcje || [];
  if (!kolejka.length && !gotowe.length) { el.innerHTML = ''; return; }
  const czas = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  el.innerHTML = `<section class="karta nagrania">
    <h3>🎙 Nagrania</h3>
    ${kolejka.map((n) => `<div class="nagranie ${n.status}">
      ${n.status === 'blad'
        ? `⚠ ${h(n.blad)} <div class="rzad"><button class="sredni" data-akcja="ponowNagranie">↻ Ponów</button><button class="sredni niebezpieczny" data-akcja="usunNagranie" data-id="${n.id}">🗑 Usuń nagranie</button></div>`
        : n.status === 'wysylanie' ? `⏳ Zamieniam mowę na tekst… (${czas(n.sekundy)})`
        : navigator.onLine || N.trybTestowy() ? `⏳ Czeka na wysłanie (${czas(n.sekundy)})` : `📶 Brak internetu – nagranie (${czas(n.sekundy)}) czeka w telefonie i wyśle się samo`}
    </div>`).join('')}
    ${gotowe.map((tr) => `<div class="nagranie gotowe">
      <div class="opis">${godzinaPL(tr.kiedy)} · ${h(tr.imie || '')} · ${czas(tr.sekundy || 0)} · ${statusAI(tr)}</div>
      <div class="transkrypcja">„${h(tr.tekst)}”</div>
    </div>`).join('')}
    ${gotowe.length ? `<button class="sredni" data-akcja="ponowAI">🤖 Wypełnij jeszcze raz ze wszystkich nagrań</button>` : ''}
  </section>`;
  // Karta wyniku AI (nad nagraniami).
  const a = biezacy.ostatnieAI;
  if (a && !a.zatwierdzone) {
    el.insertAdjacentHTML('afterbegin', `<section class="karta karta-ai">
      <h3>🤖 AI uzupełniło protokół</h3>
      ${a.podsumowanie ? `<p>${h(a.podsumowanie)}</p>` : ''}
      <p class="info">Zmienione pola: ${a.zmienione.length}${a.flagi ? ` · <b>⚠ do sprawdzenia / uzupełnienia: ${a.flagi}</b>` : ''}. Pola wypełnione przez AI mają niebieskie tło – popraw dotknięciem, jeśli trzeba. (Oznaczenia nie trafiają do PDF.)</p>
      <div class="rzad">
        <button class="sredni" data-akcja="cofnijAI">↶ Cofnij</button>
        <button class="sredni glowny" data-akcja="zatwierdzAI">✓ Zatwierdź</button>
      </div>
    </section>`);
  }
}

const aiTrwa = new Set();
function statusAI(tr) {
  if (aiTrwa.has(biezacy && biezacy.id) && tr.ai === 'czeka') return '🤖 AI wypełnia protokół…';
  if (tr.ai === 'gotowe') return '🤖 ✓ uzupełniono';
  if (tr.ai === 'blad') return `<span class="czerwony">⚠ AI: ${h(tr.aiBlad || 'błąd')}</span>`;
  if (tr.ai === 'czeka') return navigator.onLine || N.trybTestowy() ? '🤖 czeka na AI' : '📶 AI po powrocie internetu';
  return '';
}

// Lista protokołów czekających na AI (np. gdy zabrakło internetu) – tylko w tym telefonie.
function listaAI() { try { return JSON.parse(localStorage.getItem('aiDoZrobienia') || '[]'); } catch (e) { return []; } }
function zapamietajAI(id, dodaj) {
  const l = new Set(listaAI()); dodaj ? l.add(id) : l.delete(id);
  try { localStorage.setItem('aiDoZrobienia', JSON.stringify([...l])); } catch (e) { /* trudno */ }
}

// Claude uzupełnia protokół na podstawie transkrypcji, które czekają na AI.
async function uruchomAI(protokolId, { ponow = false } = {}) {
  if (aiTrwa.has(protokolId)) return;
  const otwarty = () => biezacy && biezacy.id === protokolId;
  const pobierz = async () => (otwarty() ? biezacy : await baza.pobierz('protokoly', protokolId));
  let p = await pobierz();
  if (!p) { zapamietajAI(protokolId, false); return; }
  const doZrobienia = (p.transkrypcje || []).filter((tr) => tr.ai === 'czeka' || (ponow && tr.ai === 'blad'));
  if (!doZrobienia.length) { zapamietajAI(protokolId, false); return; }
  const testowy = N.trybTestowy();
  if (!navigator.onLine && !testowy) { zapamietajAI(protokolId, true); return; }
  const ids = new Set(doZrobienia.map((tr) => tr.id));
  const zapisz = async (prot) => {
    if (otwarty()) {
      biezacy.niezapisane = true;
      await zapiszTeraz();
      const y = window.scrollY;
      await ekranProtokol(biezacy.id, biezacy);
      window.scrollTo(0, y);
    } else {
      prot.zmieniono = Date.now(); prot.zmienil = C.sesja.konto; prot.zmienilImie = C.sesja.imie;
      await baza.zapisz('protokoly', prot);
    }
  };
  aiTrwa.add(protokolId); odswiezNagrania();
  try {
    const klucze = await N.pobierzKlucze();
    const { wynik, zuzycie } = await AI.wypelnijZNagran(p, doZrobienia, {
      klucz: klucze.anthropic, model: klucze.modelAI || AI.MODEL_AI_DOMYSLNY, slownik: await N.wczytajSlownik(), testowy,
    });
    p = (await pobierz()) || p; // świeży stan – ktoś mógł w międzyczasie coś zmienić
    AI.zastosujWynik(p, wynik);
    p.transkrypcje = p.transkrypcje.map((tr) => (ids.has(tr.id) ? { ...tr, ai: 'gotowe', aiBlad: null } : tr));
    aiTrwa.delete(protokolId);
    await zapisz(p);
    zapamietajAI(protokolId, false);
    if (zuzycie) N.zapiszZuzycie({ rodzaj: 'ai', ...zuzycie });
    pokazKomunikat('🤖 AI uzupełniło protokół – sprawdź pola z niebieskim tłem');
  } catch (e) {
    console.error(e);
    aiTrwa.delete(protokolId);
    if (e.ponawiaj !== false && !(e instanceof TypeError)) {
      zapamietajAI(protokolId, true); // np. brak sieci – spróbujemy później
      pokazKomunikat(`🤖 ${e.message}`);
    } else {
      p = (await pobierz()) || p;
      p.transkrypcje = p.transkrypcje.map((tr) => (ids.has(tr.id) ? { ...tr, ai: 'blad', aiBlad: e.message } : tr));
      await zapisz(p);
      zapamietajAI(protokolId, false);
    }
  } finally {
    aiTrwa.delete(protokolId);
    odswiezNagrania();
  }
}
async function przetworzOczekujaceAI() {
  for (const id of listaAI()) await uruchomAI(id);
}

// Dopisuje gotową transkrypcję do protokołu (bez nadpisywania innych zmian).
async function zapiszTranskrypcje(protokolId, wpis) {
  if (biezacy && biezacy.id === protokolId) {
    biezacy.transkrypcje = [...(biezacy.transkrypcje || []), wpis];
    biezacy.niezapisane = true;
    await zapiszTeraz();
    odswiezNagrania();
  } else {
    C.F.updateDoc(C.F.doc(C.fs, 'protokoly', protokolId), { transkrypcje: C.F.arrayUnion(wpis) })
      .catch((e) => console.error(e));
  }
  zapamietajAI(protokolId, true);
  uruchomAI(protokolId); // od razu: Claude uzupełnia protokół
}

let czasomierzKolejki = null;
async function przetworzKolejke(opcje) {
  await N.przetworzKolejke(zapiszTranskrypcje, opcje);
  await przetworzOczekujaceAI();
  odswiezStanKolejki();
}
async function odswiezStanKolejki() {
  const ile = await N.ileWKolejce();
  const el = document.getElementById('stanKolejki');
  if (el) el.innerHTML = ile ? `<div class="flaga">🎙 Nagrania czekające na przetworzenie: ${ile}${navigator.onLine ? '' : ' (brak internetu)'}</div>` : '';
  clearTimeout(czasomierzKolejki);
  if (ile) czasomierzKolejki = setTimeout(() => przetworzKolejke(), 60000); // ponów za minutę
}
N.przyZmianieKolejki(({ protokolId }) => { if (biezacy && biezacy.id === protokolId) odswiezNagrania(); });
window.addEventListener('online', () => przetworzKolejke());
window.addEventListener('offline', () => { odswiezNagrania(); odswiezStanKolejki(); });

// Ekran nagrywania (na całą stronę).
let nagrywarka = null;
async function rozpocznijNagranie() {
  await zapiszTeraz();
  const protokolId = biezacy.id;
  nagrywarka = new N.Nagrywarka();
  try {
    await nagrywarka.start();
  } catch (e) {
    nagrywarka = null;
    alert(e.name === 'NotAllowedError'
      ? 'Brak zgody na mikrofon. Zezwól na mikrofon w ustawieniach przeglądarki dla tej strony.'
      : `Nie udało się włączyć mikrofonu: ${e.message}`);
    return;
  }
  const okno = document.createElement('div');
  okno.className = 'nagrywanie';
  okno.innerHTML = `<div class="kropka"></div>
    <div class="czas" id="czasNagrania">0:00</div>
    <p>Mów swobodnie – np. „nawiew sprawny, łożyska do wymiany, prąd 3,2 ampera…”</p>
    <button class="duzy stop" data-n="stop">⏹ Zakończ nagranie</button>
    <button class="sredni" data-n="anuluj">Anuluj (nie zapisuj)</button>`;
  document.body.appendChild(okno);
  const licznik = setInterval(() => {
    const s = nagrywarka.sekundy();
    document.getElementById('czasNagrania').textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }, 250);
  okno.addEventListener('click', async (e) => {
    const co = e.target.closest('[data-n]');
    if (!co) return;
    clearInterval(licznik);
    okno.remove();
    if (co.dataset.n === 'anuluj') { nagrywarka.anuluj(); nagrywarka = null; return; }
    const nagranie = await nagrywarka.stop();
    nagrywarka = null;
    if (nagranie.sekundy < 1 || !nagranie.blob.size) return pokazKomunikat('Nagranie za krótkie');
    await N.dodajDoKolejki(protokolId, nagranie);
    pokazKomunikat(navigator.onLine ? 'Nagranie zapisane – zamieniam na tekst…' : 'Nagranie zapisane w telefonie – wyśle się po powrocie internetu');
    odswiezNagrania();
    przetworzKolejke();
  });
}

// Administrator: ostrzeżenie o kończącej się ważności kluczy API.
async function ostrzezeniaKluczy() {
  if (!jestAdminem()) return;
  const dniOdKopii = (Date.now() - ostatniaKopia()) / 86400000;
  const przypomnienieKopii = dniOdKopii > 14
    ? `<a class="flaga przycisk-link-flaga" href="#/kopia">💾 ${ostatniaKopia() ? `Ostatnia kopia zapasowa: ${Math.floor(dniOdKopii)} dni temu` : 'Nie masz jeszcze kopii zapasowej'} – dotknij, aby ją zrobić.</a>` : '';
  const k = await N.pobierzKlucze();
  const teksty = [['OpenAI', k.openai && k.openaiWygasa], ['Anthropic', k.anthropic && k.anthropicWygasa]]
    .filter(([, data]) => data && dniDo(data) <= 14)
    .map(([nazwa, data]) => (dniDo(data) < 0
      ? `⛔ Klucz ${nazwa} wygasł – nagrania/AI nie działają. Wygeneruj nowy klucz i wpisz go w: Administrator → Klucze API.`
      : `⚠ Klucz ${nazwa} wygasa za ${dniDo(data)} dni (${P.dataPL(data)}) – wygeneruj nowy i wpisz w: Administrator → Klucze API.`));
  const el = document.getElementById('ostrzezeniaKluczy');
  if (el) el.innerHTML = teksty.map((x) => `<a class="flaga przycisk-link-flaga" href="#/klucze">${h(x)}</a>`).join('') + przypomnienieKopii;
}

// ------------------------------------------------------------
// EKRAN: ustawienia
// ------------------------------------------------------------
async function ekranUstawienia() {
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/">‹</a><h1>Ustawienia</h1></header>
    <main>
      <section class="karta">
        <h3>Tryb testowy</h3>
        <p class="info">Na tym urządzeniu nagrania i AI są udawane – możesz ćwiczyć bez żadnych kosztów. Do prawdziwej pracy wyłącz.</p>
        <label class="przelacznik"><input type="checkbox" id="trybTestowy" ${N.trybTestowy() ? 'checked' : ''}> Tryb testowy włączony</label>
      </section>
      <a class="duzy przycisk-link" href="#/slownik">📖 Słownik terminów</a>
    </main>`;
}

// ------------------------------------------------------------
// EKRANY ADMINISTRATORA: menu i klucze API
// ------------------------------------------------------------
function ekranAdministrator() {
  if (!jestAdminem()) return idzDo('#/');
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/">‹</a><h1>Administrator</h1></header>
    <main>
      <a class="duzy przycisk-link" href="#/uzytkownicy">👥 Użytkownicy i kody</a>
      <a class="duzy przycisk-link" href="#/koszty">💰 Koszty i zużycie</a>
      <a class="duzy przycisk-link" href="#/klucze">🔑 Klucze API</a>
      <a class="duzy przycisk-link" href="#/kopia">💾 Kopia zapasowa</a>
      <a class="duzy przycisk-link" href="#/testai">🧪 Test jakości AI</a>
      <div id="ostrzezeniaKluczy"></div>
    </main>`;
  ostrzezeniaKluczy();
}

// ------------------------------------------------------------
// EKRAN: test jakości AI (administrator)
// ------------------------------------------------------------
let raportTestuAI = '';
async function ekranTestAI() {
  if (!jestAdminem()) return idzDo('#/');
  const T = await import('./testy-ai.js');
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/administrator">‹</a><h1>Test jakości AI</h1></header>
    <main class="formularz">
      <p>Aplikacja wyśle do Claude <b>${T.SCENARIUSZE.length} przykładowych wypowiedzi</b> serwisanta i sprawdzi, czy wypełnienie zgadza się z zasadami
      (cała sekcja OK, wyjątki, „brak”, liczby, żargon, niejasności, poprawki, termin, uwagi).</p>
      <p class="info">Koszt jednego testu: ok. 1 zł (klucz Anthropic z „Klucze API”). Nie zmienia żadnych protokołów.</p>
      <button class="duzy glowny" data-akcja="uruchomTestAI" id="przyciskTestuAI">▶ Uruchom test</button>
      <div id="wynikiTestu"></div>
    </main>`;
}

// ------------------------------------------------------------
// EKRAN: koszty i zużycie (administrator)
// ------------------------------------------------------------
const miesiacTeraz = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
let miesiacKosztow = null;

async function ekranKoszty() {
  if (!jestAdminem()) return idzDo('#/');
  const miesiac = miesiacKosztow || miesiacTeraz();
  ekran.innerHTML = `<header class="pasek"><a class="wstecz" href="#/administrator">‹</a><h1>Koszty i zużycie</h1></header>
    <main><p class="pusto">Liczę…</p></main>`;
  let budzet, wpisy, saldoA, saldoO, klucze;
  try {
    [budzet, wpisy, klucze] = await Promise.all([K.pobierzBudzet(), K.zuzycieMiesiaca(miesiac), N.pobierzKlucze(true)]);
    [saldoA, saldoO] = await Promise.all([K.szacujSaldo(budzet, 'anthropic'), K.szacujSaldo(budzet, 'openai')]);
  } catch (e) {
    console.error(e);
    ekran.querySelector('main').innerHTML = '<p class="pusto">Panel kosztów wymaga internetu.</p>';
    return;
  }
  const kurs = budzet.kurs || 4.0;
  const s = K.podsumuj(wpisy);
  const liczba = (x, m = 2) => x.toLocaleString('pl-PL', { minimumFractionDigits: m, maximumFractionDigits: m });
  const usd = (x) => `${liczba(x)} USD`;
  const pln = (x) => `≈ ${liczba(x * kurs)} zł`;
  const maxDzien = Math.max(0.0001, ...Object.values(s.dni));
  const kartaSalda = (nazwa, serwis, sal, kluczWygasa, panel) => `<section class="karta">
    <h3>${nazwa}</h3>
    ${sal ? `<div class="duza-liczba ${sal.pozostalo < 2 ? 'czerwony' : ''}">${usd(Math.max(0, sal.pozostalo))}</div>
      <p class="info">szacowane saldo · ${pln(Math.max(0, sal.pozostalo))} · od ${godzinaPL(sal.data)} zużyto ${usd(sal.zuzyte)}</p>
      <p>${sal.dniDoKonca === null ? 'Brak zużycia w ostatnich 14 dniach.' : `Średnio ${usd(sal.dziennie)} dziennie → wystarczy na ok. <b>${Math.floor(sal.dniDoKonca)} dni</b> (do ${godzinaPL(sal.koniec).slice(0, 10)})`}</p>`
      : '<p class="info">Wpisz aktualny stan konta z panelu dostawcy, a aplikacja będzie szacować saldo i datę końca środków.</p>'}
    <div class="rzad">
      <label class="pole maly">Aktualny stan konta (USD)<input type="text" inputmode="decimal" id="saldo-${serwis}" placeholder="np. 18,50"></label>
      <button class="sredni" data-akcja="ustawSaldo" data-serwis="${serwis}">Ustaw</button>
    </div>
    <p class="info">Klucz: ${kluczWygasa ? opisWaznosci(kluczWygasa) || 'ważny' : 'bez daty ważności'} · <a href="${panel}" target="_blank" rel="noopener">otwórz panel rozliczeń ↗</a></p>
  </section>`;

  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/administrator">‹</a><h1>Koszty i zużycie</h1></header>
    <main>
      <label class="pole">Miesiąc <input type="month" id="miesiacKosztow" value="${miesiac}"></label>
      <section class="karta karta-ai">
        <h3>Razem w miesiącu</h3>
        <div class="duza-liczba">${usd(s.razem)}</div>
        <p class="info">${pln(s.razem)} (kurs ${liczba(kurs)} zł/USD)</p>
        <div class="tabela">
          <div><span>🎙 Transkrypcja (OpenAI)</span><b>${usd(s.openai)}</b></div>
          <div><span class="info">nagrania: ${liczba(s.minuty, 1)} min</span><span></span></div>
          <div><span>🤖 Wypełnianie AI (Anthropic)</span><b>${usd(s.anthropic)}</b></div>
          <div><span class="info">wypełnień: ${s.wypelnienia}${s.testy ? ` + testy: ${s.testy}` : ''}</span><span></span></div>
          ${s.wypelnienia ? `<div><span>Średnio na wypełnienie (z transkrypcją)</span><b>${liczba((s.razem - s.kosztTestow) / s.wypelnienia * 100, 1)} centa</b></div>` : ''}
        </div>
      </section>
      <section class="karta">
        <h3>👥 Na osobę</h3>
        ${Object.keys(s.osoby).length ? `<div class="tabela">${Object.entries(s.osoby).sort((a, b) => b[1] - a[1])
          .map(([o, x]) => `<div><span>${h(o)}</span><b>${usd(x)}</b></div>`).join('')}</div>` : '<p class="info">Brak zużycia w tym miesiącu.</p>'}
      </section>
      <section class="karta">
        <h3>📅 Dziennie</h3>
        ${Object.keys(s.dni).length ? Object.entries(s.dni).sort().map(([d, x]) => `<div class="slupek">
          <span>${P.dataPL(d).slice(0, 5)}</span><div class="pasek-tlo"><div style="width:${Math.round((x / maxDzien) * 100)}%"></div></div><b>${liczba(x)}</b></div>`).join('')
          : '<p class="info">Brak danych.</p>'}
      </section>
      ${kartaSalda('💳 Anthropic (Claude)', 'anthropic', saldoA, klucze.anthropicWygasa, 'https://console.anthropic.com/settings/billing')}
      ${kartaSalda('💳 OpenAI (transkrypcja)', 'openai', saldoO, klucze.openaiWygasa, 'https://platform.openai.com/settings/organization/billing/overview')}
      <section class="karta">
        <h3>Pozostałe usługi</h3>
        <div class="tabela">
          <div><span>Firebase (baza, logowanie)</span><b>0 zł – plan darmowy</b></div>
          <div><span>GitHub Pages (strona)</span><b>0 zł</b></div>
          <div><span>Claude Code (budowa aplikacji)</span><b>Twoja subskrypcja Claude</b></div>
        </div>
        <p class="info">Aplikacja do działania potrzebuje tylko OpenAI i Anthropic. Subskrypcja Claude jest potrzebna wyłącznie do zmian w aplikacji.</p>
        <label class="pole maly">Kurs USD → zł <input type="text" inputmode="decimal" id="kursUSD" value="${liczba(kurs)}"></label>
        <button class="sredni" data-akcja="zapiszKurs">Zapisz kurs</button>
      </section>
      <p class="info">Kwoty są szacunkowe – liczone z zapisanego zużycia i cennika w aplikacji. Dokładne rozliczenie: panele OpenAI i Anthropic.</p>
    </main>`;
}

// ------------------------------------------------------------
// EKRAN: słownik terminów (administrator)
// ------------------------------------------------------------
async function ekranSlownik() {
  const terminy = await N.wczytajSlownik(true);
  const kto = N.ktoZmienilSlownik();
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/ustawienia">‹</a><h1>Słownik terminów</h1></header>
    <main class="formularz">
      <p class="info">Nazwy producentów, modele central, skróty i żargon – <b>jeden termin w linii</b>. Słownik pomaga w rozpoznawaniu mowy i w rozumieniu nagrań przez AI. Wspólny dla całego zespołu.</p>
      <label class="pole">Terminy (<span id="ileTerminow">${terminy.length}</span>)
        <textarea id="terminy" rows="18">${h(terminy.join('\n'))}</textarea>
      </label>
      ${kto ? `<p class="info">Ostatnia zmiana: ${h(kto.imie)}, ${godzinaPL(kto.kiedy)}</p>` : ''}
      <button class="sredni" data-akcja="slownikStartowy">↺ Przywróć listę startową</button>
    </main>
    <footer class="dolny"><button class="duzy glowny" data-akcja="zapiszSlownik">💾 Zapisz słownik</button></footer>`;
}

// ------------------------------------------------------------
// EKRAN: kopia zapasowa (administrator)
// ------------------------------------------------------------
const KOLEKCJE_KOPII = ['grupy', 'przeglady', 'protokoly'];
function ostatniaKopia() { try { return +localStorage.getItem('ostatniaKopia') || 0; } catch (e) { return 0; } }

async function ekranKopia() {
  if (!jestAdminem()) return idzDo('#/');
  const ost = ostatniaKopia();
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/administrator">‹</a><h1>Kopia zapasowa</h1></header>
    <main>
      <section class="karta">
        <h3>💾 Zapisz kopię</h3>
        <p class="info">Wszystkie grupy, przeglądy i protokoły w jednym pliku. Dane są i tak w chmurze (Firebase) – kopia to dodatkowe zabezpieczenie, np. na Dysku Google lub w mailu.</p>
        <p>Ostatnia kopia z tego urządzenia: <b>${ost ? godzinaPL(ost) : 'nigdy'}</b></p>
        <button class="duzy glowny" data-akcja="eksportKopii">💾 Utwórz kopię</button>
      </section>
      <section class="karta">
        <h3>↺ Przywróć z kopii</h3>
        <p class="info">Protokoły z pliku zostaną zapisane w bazie. Protokoły o tych samych identyfikatorach zostaną nadpisane wersją z kopii, pozostałe – bez zmian.</p>
        <label class="duzy przycisk-link wybor-pliku">📂 Wybierz plik kopii
          <input type="file" id="plikKopii" accept=".json,application/json">
        </label>
      </section>
    </main>`;
}

async function ekranKlucze() {
  if (!jestAdminem()) return idzDo('#/');
  const klucze = await N.pobierzKlucze(true);
  const ukryj = (k) => (k ? `zapisany (…${h(k.slice(-4))})` : 'brak');
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/administrator">‹</a><h1>Klucze API</h1></header>
    <main>
      <section class="karta">
        <h3>🔑 Klucze API (dla całego zespołu)</h3>
        <p class="info">Klucze trafiają do wspólnej bazy – widzą je tylko zalogowane osoby z zespołu. Ustaw miesięczne limity wydatków w panelach OpenAI i Anthropic!</p>
        <label class="pole">Klucz OpenAI (transkrypcja) – ${ukryj(klucze.openai)}
          <input type="password" id="kluczOpenai" placeholder="sk-… (wklej, aby zmienić)" autocomplete="off">
        </label>
        <label class="pole">Klucz OpenAI ważny jeszcze (dni) ${klucze.openaiWygasa ? `– ${opisWaznosci(klucze.openaiWygasa)}, do ${P.dataPL(klucze.openaiWygasa)}` : ''}
          <input type="number" inputmode="numeric" min="0" id="openaiDni" value="${pozostaloDni(klucze.openaiWygasa)}" placeholder="np. 90 (puste = nie wygasa)">
        </label>
        <label class="pole">Model transkrypcji
          <input type="text" id="modelTranskrypcji" value="${h(klucze.modelTranskrypcji || N.MODEL_DOMYSLNY)}">
        </label>
        <label class="pole">Klucz Anthropic (Claude – wypełnianie protokołu) – ${ukryj(klucze.anthropic)}
          <input type="password" id="kluczAnthropic" placeholder="sk-ant-… (wklej, aby zmienić)" autocomplete="off">
        </label>
        <label class="pole">Klucz Anthropic ważny jeszcze (dni) ${klucze.anthropicWygasa ? `– ${opisWaznosci(klucze.anthropicWygasa)}, do ${P.dataPL(klucze.anthropicWygasa)}` : ''}
          <input type="number" inputmode="numeric" min="0" id="anthropicDni" value="${pozostaloDni(klucze.anthropicWygasa)}" placeholder="puste = nie wygasa">
        </label>
        <label class="pole">Model AI
          <input type="text" id="modelAI" value="${h(klucze.modelAI || AI.MODEL_AI_DOMYSLNY)}">
        </label>
        <button class="duzy glowny" data-akcja="zapiszKlucze">💾 Zapisz</button>
        <button class="sredni" data-akcja="sprawdzOpenai">🔍 Sprawdź klucz OpenAI (bez kosztów)</button>
        <button class="sredni" data-akcja="sprawdzAnthropic">🔍 Sprawdź klucz Anthropic (bez kosztów)</button>
        <div id="wynikSprawdzenia"></div>
        <p class="info">Limity wydatków: platform.openai.com → Settings → Limits oraz console.anthropic.com → Settings → Limits.</p>
      </section>
    </main>`;
}

// ------------------------------------------------------------
// PDF: wybór protokołów i tworzenie pliku
// ------------------------------------------------------------
let wyborPdf = null; // { protokoly, nazwaPliku, wybrane: Set }

// Nazwa pliku: zwykłe spacje, bez myślników; usuwamy tylko znaki zakazane w Windows.
const nazwaPlikuPdf = (...czesci) => `${czesci.map((c) => String(c ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim())
  .filter(Boolean).join(' ')}.pdf`;

async function ekranWyboruPdf(rodzaj, id) {
  let protokoly, przeglady, grupa;
  if (rodzaj === 'przeglad') {
    const pg = await baza.pobierz('przeglady', id);
    if (!pg) return idzDo('#/');
    grupa = await baza.pobierz('grupy', pg.grupaId);
    przeglady = [pg];
    protokoly = await protokolyPrzegladu(id);
  } else {
    grupa = await baza.pobierz('grupy', id);
    if (!grupa) return idzDo('#/');
    przeglady = sortujPrzeglady(await baza.wgIndeksu('przeglady', 'grupaId', id)).reverse(); // od najstarszego
    protokoly = sortujProtokoly(await baza.wgIndeksu('protokoly', 'grupaId', id));
  }
  // Kolejność w pliku: data przeglądu, potem kolejność dodania central.
  const kolejnosc = przeglady.map((x) => x.id);
  protokoly.sort((a, b) => kolejnosc.indexOf(a.przegladId) - kolejnosc.indexOf(b.przegladId) || a.utworzono - b.utworzono);
  wyborPdf = { protokoly, przeglady, grupa, wybrane: new Set(protokoly.map((p) => p.id)) };

  const powrot = rodzaj === 'przeglad' ? `#/przeglad/${id}` : `#/grupa/${id}`;
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="${powrot}">‹</a><h1>PDF – ${h(grupa.nazwa)}</h1></header>
    <main class="formularz">
      <p class="info">Każdy protokół zaczyna się od nowej strony i ma własną numerację – jak osobne pliki połączone w jeden.</p>
      <div class="rzad">
        <button class="sredni" data-akcja="pdfWszystkie" data-wartosc="1">☑ Zaznacz wszystkie</button>
        <button class="sredni" data-akcja="pdfWszystkie" data-wartosc="">☐ Odznacz</button>
      </div>
      ${przeglady.map((pg) => {
        const lista = protokoly.filter((p) => p.przegladId === pg.id);
        if (!lista.length) return '';
        return `<h2>Przegląd ${P.dataPL(pg.data)} ${przeglady.length > 1 ? `<button class="maly-link" data-akcja="pdfPrzeglad" data-id="${pg.id}">zaznacz/odznacz</button>` : ''}</h2>
          ${lista.map((p) => {
            const st = P.postep(p);
            return `<label class="wiersz wybor-pdf">
              <input type="checkbox" checked data-pdf="${p.id}" data-przeglad="${pg.id}">
              <span><span class="tytul">${h(P.opisCentrali(p))}</span>
              <span class="opis">nr fabr. ${h(p.naglowek.nrFabr || '–')} · 👤 ${h(p.autorImie || '–')}${p.zmienilImie && p.zmienil !== p.autor ? `, edytował: ${h(p.zmienilImie)}` : ''}
                ${st.gotowy ? '<span class="plakietka ok">✓</span>' : `<span class="plakietka brak">braki: ${st.brakuje + st.flagi}</span>`}</span></span>
            </label>`;
          }).join('')}`;
      }).join('')}
    </main>
    <footer class="dolny">
      <button class="duzy glowny" data-akcja="utworzPdf" id="przyciskPdf">📄 Utwórz PDF (${protokoly.length})</button>
    </footer>`;
}

function odswiezLicznikPdf() {
  document.querySelectorAll('[data-pdf]').forEach((el) => { el.checked = wyborPdf.wybrane.has(el.dataset.pdf); });
  const b = document.getElementById('przyciskPdf');
  if (b) b.textContent = `📄 Utwórz PDF (${wyborPdf.wybrane.size})`;
}

async function generujPdf(protokoly, nazwaPliku) {
  const zBrakami = protokoly.filter((p) => !P.postep(p).gotowy).length;
  if (zBrakami && !confirm(`${zBrakami} z ${protokoly.length} protokołów ma braki lub pola do sprawdzenia. Utworzyć PDF mimo to?`)) return;
  pokazKomunikat('Tworzę PDF…');
  const nazwyGrup = {};
  for (const gid of new Set(protokoly.map((p) => p.grupaId))) {
    nazwyGrup[gid] = ((await baza.pobierz('grupy', gid)) || {}).nazwa || '';
  }
  try {
    const { utworzPdf } = await import('./pdf.js');
    const bajty = await utworzPdf(protokoly.map((p) => ({ protokol: p, obiekt: nazwyGrup[p.grupaId] })));
    pokazGotowyPdf(new File([bajty], nazwaPliku, { type: 'application/pdf' }));
  } catch (e) {
    console.error(e);
    alert('Nie udało się utworzyć PDF: ' + e.message);
  }
}

function pokazGotowyPdf(plik) { pokazGotowyPlik(plik, '✓ PDF gotowy'); }
// Nazwa do zapisu na dysku: bez polskich liter (część przeglądarek zamienia
// takie nazwy na „download”). Przy „Udostępnij” zostaje pełna polska nazwa.
const bezPolskichLiter = (s) => s.replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function pokazGotowyPlik(plik, tytul) {
  const adres = URL.createObjectURL(plik);
  const moznaUdostepnic = navigator.canShare && navigator.canShare({ files: [plik] });
  const okno = document.createElement('div');
  okno.className = 'okno-tlo';
  okno.innerHTML = `<div class="okno">
    <h3>${h(tytul)}</h3>
    <p class="info">${h(plik.name)} · ${Math.max(1, Math.round(plik.size / 1024))} KB</p>
    <a class="duzy glowny przycisk-link" href="${adres}" download="${h(bezPolskichLiter(plik.name))}" target="_blank">💾 Otwórz / zapisz</a>
    ${moznaUdostepnic ? '<button class="duzy" data-okno="udostepnij">📤 Udostępnij (e-mail, Dysk, WhatsApp…)</button>' : ''}
    <button class="sredni" data-okno="zamknij">Zamknij</button>
  </div>`;
  okno.addEventListener('click', async (e) => {
    const co = e.target.closest('[data-okno]');
    if (e.target === okno || (co && co.dataset.okno === 'zamknij')) {
      okno.remove();
      setTimeout(() => URL.revokeObjectURL(adres), 60000);
    } else if (co && co.dataset.okno === 'udostepnij') {
      try { await navigator.share({ files: [plik], title: plik.name }); } catch (err) { /* anulowano */ }
    }
  });
  document.body.appendChild(okno);
}

// ------------------------------------------------------------
// ZDJĘCIA -> PDF (wszystko w telefonie, bez kosztów)
// ------------------------------------------------------------
let zdjecia = []; // [{ id, plik, mini }] – kolejność = kolejność stron
let dodawanieZdjec = Promise.resolve();

function ekranZdjecia() {
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/">‹</a><h1>Zdjęcia → PDF</h1></header>
    <main class="formularz">
      <p class="info">Każde zdjęcie to osobna strona A4 (poziome zdjęcie = pozioma strona). Bez limitu zdjęć, bez znaków wodnych. Nic nie jest wysyłane do internetu.</p>
      <div class="rzad">
        <label class="duzy glowny przycisk-link wybor-pliku">🖼 Z galerii
          <input type="file" id="wybierzZdjecia" accept="image/*" multiple>
        </label>
        <label class="duzy przycisk-link wybor-pliku">📷 Aparat
          <input type="file" id="zrobZdjecie" accept="image/*" capture="environment">
        </label>
      </div>
      <label class="pole">Nazwa pliku
        <input type="text" id="nazwaZdjec" value="Zdjęcia ${P.dataPL(P.dzisiaj())}">
      </label>
      <div id="listaZdjec"></div>
    </main>
    <footer class="dolny">
      <button class="duzy glowny" data-akcja="zdjPdf" id="przyciskZdjPdf"></button>
    </footer>`;
  odswiezZdjecia();
}

function odswiezZdjecia() {
  const lista = document.getElementById('listaZdjec');
  if (!lista) return;
  lista.innerHTML = zdjecia.length ? `
    <h2>Zdjęcia (${zdjecia.length}) <button class="maly-link" data-akcja="zdjWyczysc">usuń wszystkie</button></h2>
    <div class="siatka-zdjec">
      ${zdjecia.map((z, i) => `<div class="zdjecie">
        ${z.mini ? `<img src="${z.mini}" alt="">` : `<div class="laduje">${z.mini === '' ? '⚠ brak podglądu' : '…'}</div>`}
        <div class="nr-strony">${i + 1}</div>
        <div class="zdj-przyciski">
          <button data-akcja="zdjPrzesun" data-i="${i}" data-o="-1" ${i === 0 ? 'disabled' : ''} aria-label="Wcześniej">◀</button>
          <button data-akcja="zdjUsun" data-i="${i}" aria-label="Usuń">✕</button>
          <button data-akcja="zdjPrzesun" data-i="${i}" data-o="1" ${i === zdjecia.length - 1 ? 'disabled' : ''} aria-label="Później">▶</button>
        </div>
      </div>`).join('')}
    </div>` : '<p class="pusto">Dodaj zdjęcia z galerii albo zrób je aparatem.</p>';
  const b = document.getElementById('przyciskZdjPdf');
  if (b) { b.textContent = `📄 Utwórz PDF (${zdjecia.length})`; b.disabled = !zdjecia.length; }
}

function dodajZdjecia(pliki) {
  const wszystkie = [...pliki];
  // Niektóre telefony nie podają typu pliku – wtedy przyjmujemy plik i sprawdzamy go przy wczytaniu.
  const nowe = wszystkie.filter((p) => !p.type || p.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(p.name))
    .map((plik) => ({ id: noweId(), plik, mini: null }));
  const pominiete = wszystkie.length - nowe.length;
  pokazKomunikat(`Dodano ${nowe.length} zdjęć${pominiete ? ` (pominięto ${pominiete} – to nie są zdjęcia)` : ''}`);
  zdjecia.push(...nowe);
  odswiezZdjecia();
  // Miniatury po kolei (oszczędza pamięć telefonu).
  dodawanieZdjec = dodawanieZdjec.then(async () => {
    for (const z of nowe) {
      try { z.mini = await (await import('./zdjecia.js')).miniatura(z.plik); } catch (e) { z.mini = ''; }
      odswiezZdjecia();
    }
  });
}

// ------------------------------------------------------------
// EKRANY LOGOWANIA
// ------------------------------------------------------------
function ekranLogowania(stan, blad = '') {
  const tresci = {
    logowanie: `
      <p>Wpisz swoje <b>imię</b> oraz <b>6-cyfrowy kod</b> otrzymany od administratora.</p>
      <label class="pole">Imię <input id="logImie" type="text" autocomplete="given-name"></label>
      <label class="pole">Kod <input id="logKod" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>
      <button class="duzy glowny" data-akcja="zaloguj">Zaloguj</button>
      <p class="info">Kod działa jeden raz. Na nowym telefonie lub komputerze poproś administratora o nowy kod.</p>`,
    pierwszeKonto: `
      <p><b>Pierwsze uruchomienie.</b> Baza jest pusta – zakładasz konto <b>administratora</b>.
      Tylko administrator może dodawać kolejne osoby i wydawać im kody.</p>
      <label class="pole">Twoje imię <input id="logImie" type="text" autocomplete="given-name"></label>
      <button class="duzy glowny" data-akcja="zalozAdmina">Załóż konto administratora</button>`,
    zablokowane: `<p>⛔ To konto zostało <b>zablokowane</b> przez administratora.</p>
      <button class="duzy" data-akcja="sprobujPonownie">Sprawdź ponownie</button>`,
    brakSieci: `<p>📶 Do <b>pierwszego</b> logowania na tym urządzeniu potrzebny jest internet.
      Później aplikacja działa także bez zasięgu.</p>
      <button class="duzy" data-akcja="sprobujPonownie">Spróbuj ponownie</button>`,
  };
  ekran.innerHTML = `
    <header class="pasek"><h1>Protokoły – logowanie</h1></header>
    <main>
      ${blad ? `<div class="flaga">${h(blad)}</div>` : ''}
      ${tresci[stan]}
    </main>`;
}

async function startLogowania() {
  let wynik;
  try { wynik = await C.sprawdzLogowanie(); } catch (e) { wynik = { stan: 'brakSieci' }; }
  if (wynik.stan === 'ok') { przetworzKolejke(); return pokaz(); }
  ekranLogowania(wynik.stan);
}

// ------------------------------------------------------------
// EKRAN: użytkownicy (tylko administrator)
// ------------------------------------------------------------
let ostatniKod = null; // { imie, kod, wazneDo } – pokazywany po wygenerowaniu

async function ekranUzytkownicy() {
  if (!jestAdminem()) return idzDo('#/');
  ekran.innerHTML = `<header class="pasek"><a class="wstecz" href="#/administrator">‹</a><h1>Użytkownicy</h1></header>
    <main><p class="pusto">Wczytywanie…</p></main>`;
  let konta;
  try { konta = await C.listaKont(); } catch (e) {
    ekran.querySelector('main').innerHTML = '<p class="pusto">Lista użytkowników wymaga internetu.</p>';
    return;
  }
  const dataG = (d) => godzinaPL(d.getTime());
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/administrator">‹</a><h1>Użytkownicy</h1></header>
    <main>
      ${ostatniKod ? `<div class="karta kod-karta">
        Kod dla <b>${h(ostatniKod.imie)}</b>:
        <div class="kod">${ostatniKod.kod.slice(0, 3)} ${ostatniKod.kod.slice(3)}</div>
        Ważny do ${dataG(ostatniKod.wazneDo)}, działa jeden raz.<br>
        Przekaż go tej osobie razem z adresem aplikacji. Przy logowaniu musi wpisać imię dokładnie: <b>${h(ostatniKod.imie)}</b>.
        <button class="sredni" data-akcja="udostepnijKod">📤 Wyślij (SMS / komunikator)</button>
      </div>` : ''}
      <button class="duzy glowny" data-akcja="dodajOsobe">＋ Dodaj osobę</button>
      <ul class="lista">
        ${konta.map((k) => `<li class="karta osoba ${k.aktywny ? '' : 'zablokowana'}">
          <div class="tytul">${h(k.imie)} ${k.admin ? '<span class="plakietka ok">administrator</span>' : ''}
            ${k.aktywny ? '' : '<span class="plakietka brak">zablokowane</span>'}</div>
          <div class="opis">Urządzenia: ${k.urzadzen}${k.kodyAktywne.length ? ` · czekające kody: ${k.kodyAktywne.map((x) => `${x.kod} (do ${dataG(x.wazneDo)})`).join(', ')}` : ''}</div>
          <div class="rzad">
            <button class="sredni" data-akcja="kodDla" data-id="${k.id}" data-imie="${h(k.imie)}">🔑 Nowy kod</button>
            ${k.id === C.sesja.konto ? '' : `<button class="sredni ${k.aktywny ? 'niebezpieczny' : ''}" data-akcja="przelaczBlokade" data-id="${k.id}" data-aktywny="${k.aktywny ? '1' : ''}">${k.aktywny ? '⛔ Zablokuj' : '✓ Odblokuj'}</button>`}
          </div>
        </li>`).join('')}
      </ul>
      <p class="info">Zablokowanie odcina dostęp na wszystkich urządzeniach tej osoby. Jej protokoły zostają w bazie.</p>
    </main>`;
}

// ------------------------------------------------------------
// Obsługa dotknięć (jedno miejsce dla wszystkich przycisków)
// ------------------------------------------------------------
async function nowaCentrala(przegladId, zmiany = {}) {
  const przeglad = await baza.pobierz('przeglady', przegladId);
  const p = P.nowyProtokol(przeglad, {
    autor: C.sesja.konto, autorImie: C.sesja.imie, zmienil: C.sesja.konto, zmienilImie: C.sesja.imie, ...zmiany,
  });
  await baza.zapisz('protokoly', p);
  idzDo(`#/protokol/${p.id}`);
}

const akcje = {
  async ustawSaldo(el) {
    const serwis = el.dataset.serwis;
    const wartosc = parseFloat(document.getElementById(`saldo-${serwis}`).value.replace(',', '.'));
    if (!Number.isFinite(wartosc)) return pokazKomunikat('Wpisz kwotę w USD, np. 18,50');
    await K.zapiszBudzet({ [serwis]: { saldo: wartosc, data: Date.now() } });
    pokazKomunikat('Zapisano stan konta ✓');
    ekranKoszty();
  },
  async zapiszKurs() {
    const kurs = parseFloat(document.getElementById('kursUSD').value.replace(',', '.'));
    if (!Number.isFinite(kurs) || kurs <= 0) return;
    await K.zapiszBudzet({ kurs });
    ekranKoszty();
  },
  async zapiszSlownik() {
    const terminy = [...new Set(document.getElementById('terminy').value.split('\n').map((x) => x.trim()).filter(Boolean))];
    try { await N.zapiszSlownik(terminy); pokazKomunikat(`Zapisano słownik (${terminy.length} terminów) ✓`); ekranSlownik(); } catch (e) { alert('Nie udało się zapisać (potrzebny internet).'); }
  },
  async slownikStartowy() {
    if (!confirm('Zastąpić obecną listę listą startową? (Zmiana zapisze się dopiero po „Zapisz słownik”.)')) return;
    const t = await N.slownikStartowy();
    document.getElementById('terminy').value = t.join('\n');
    document.getElementById('ileTerminow').textContent = t.length;
  },
  async eksportKopii() {
    pokazKomunikat('Pobieram dane…');
    try {
      const dane = { aplikacja: 'Protokoły kontroli', wersja: 1, utworzono: new Date().toISOString(), autor: C.sesja.imie };
      for (const k of KOLEKCJE_KOPII) dane[k] = (await C.F.getDocs(C.F.collection(C.fs, k))).docs.map((d) => d.data());
      const plik = new File([JSON.stringify(dane)], `Kopia protokolow ${P.dataPL(P.dzisiaj())}.json`, { type: 'application/json' });
      try { localStorage.setItem('ostatniaKopia', String(Date.now())); } catch (e) { /* trudno */ }
      pokazGotowyPlik(plik, `✓ Kopia gotowa: ${dane.protokoly.length} protokołów`);
      ekranKopia();
    } catch (e) { console.error(e); alert('Nie udało się utworzyć kopii (potrzebny internet).'); }
  },
  async uruchomTestAI() {
    const T = await import('./testy-ai.js');
    const przycisk = document.getElementById('przyciskTestuAI');
    const wyniki = document.getElementById('wynikiTestu');
    const klucze = await N.pobierzKlucze(true);
    if (!klucze.anthropic) { wyniki.innerHTML = '<div class="flaga">Brak klucza Anthropic – wpisz go w „Klucze API”.</div>'; return; }
    const model = klucze.modelAI || AI.MODEL_AI_DOMYSLNY;
    const slownik = await N.wczytajSlownik();
    przycisk.disabled = true;
    let html = ''; let ok = 0; let wszystkie = 0;
    const tokeny = { wejscie: 0, wyjscie: 0, cacheOdczyt: 0, cacheZapis: 0 };
    const linie = [`RAPORT TESTU AI – model ${model}, ${godzinaPL(Date.now())}`];
    for (const [i, sc] of T.SCENARIUSZE.entries()) {
      przycisk.textContent = `⏳ ${i + 1} / ${T.SCENARIUSZE.length}: ${sc.nazwa}…`;
      const p = T.protokolTestowy(sc);
      let oceny; let wynik = null; let blad = '';
      try {
        const r = await AI.wypelnijZNagran(p, [{ tekst: sc.tekst }], { klucz: klucze.anthropic, model, slownik, testowy: false });
        wynik = r.wynik;
        if (r.zuzycie) { for (const k of Object.keys(tokeny)) tokeny[k] += r.zuzycie[k]; N.zapiszZuzycie({ rodzaj: 'ai-test', ...r.zuzycie }); }
        AI.zastosujWynik(p, wynik);
        oceny = T.ocen(sc, p);
      } catch (e) {
        blad = e.message;
        oceny = sc.sprawdz.map(([opis]) => ({ opis, ok: false }));
      }
      const dobre = oceny.filter((o) => o.ok).length;
      ok += dobre; wszystkie += oceny.length;
      const calosc = dobre === oceny.length;
      html += `<section class="karta ${calosc ? '' : 'test-zle'}">
        <h3>${calosc ? '✅' : '❌'} ${i + 1}. ${h(sc.nazwa)}</h3>
        <p class="info">${h(sc.zasada)}</p>
        <p class="transkrypcja">„${h(sc.tekst)}”</p>
        ${blad ? `<div class="flaga">${h(blad)}</div>` : ''}
        ${oceny.map((o) => `<div>${o.ok ? '✅' : '❌'} ${h(o.opis)}</div>`).join('')}
        ${wynik && wynik.podsumowanie ? `<p class="info">AI: ${h(wynik.podsumowanie)}</p>` : ''}
      </section>`;
      linie.push(`\n${calosc ? 'OK ' : 'ŹLE'} ${i + 1}. ${sc.nazwa} – „${sc.tekst}”`);
      oceny.filter((o) => !o.ok).forEach((o) => linie.push(`   ✗ ${o.opis}`));
      if (blad) linie.push(`   BŁĄD: ${blad}`);
      if (!calosc && wynik) linie.push(`   Odpowiedź AI: ${JSON.stringify(wynik)}`);
      wyniki.innerHTML = html;
    }
    const koszt = (tokeny.wejscie * 2 + tokeny.cacheOdczyt * 0.1 + tokeny.cacheZapis * 2.5 + tokeny.wyjscie * 10) / 1e6;
    linie.splice(1, 0, `Wynik: ${ok} / ${wszystkie} sprawdzeń poprawnych. Tokeny: wejście ${tokeny.wejscie}, cache odczyt ${tokeny.cacheOdczyt}, cache zapis ${tokeny.cacheZapis}, wyjście ${tokeny.wyjscie} (≈ ${koszt.toFixed(3)} USD)`);
    raportTestuAI = linie.join('\n');
    wyniki.insertAdjacentHTML('afterbegin', `<section class="karta karta-ai">
      <h3>Wynik: ${ok} / ${wszystkie} sprawdzeń poprawnych</h3>
      <p class="info">Szacowany koszt testu: ok. ${koszt.toFixed(3)} USD · cache: ${tokeny.cacheOdczyt ? 'działa ✓' : 'brak odczytów'}</p>
      <button class="duzy glowny" data-akcja="kopiujRaportAI">📋 Kopiuj raport</button>
      <p class="info">Wklej raport w rozmowie z Claude – na jego podstawie zostanie poprawiona instrukcja dla AI.</p>
    </section>`);
    przycisk.disabled = false; przycisk.textContent = '▶ Uruchom test ponownie';
  },
  async kopiujRaportAI() {
    try { await navigator.clipboard.writeText(raportTestuAI); pokazKomunikat('Skopiowano raport ✓'); } catch (e) {
      const pole = document.createElement('textarea');
      pole.value = raportTestuAI; pole.rows = 12; pole.style.width = '100%';
      document.getElementById('wynikiTestu').prepend(pole); pole.select();
      pokazKomunikat('Zaznacz tekst i skopiuj ręcznie');
    }
  },
  nagraj() { rozpocznijNagranie(); },
  // „✓ OK” przy oznaczeniu „do sprawdzenia” – serwisant potwierdza obecny stan pola.
  async usunFlage(el) {
    delete biezacy.flagi[el.dataset.klucz];
    biezacy.niezapisane = true; await zapiszTeraz();
    el.closest('.flaga').remove();
    odswiezLicznik();
  },
  async zatwierdzAI() {
    if (!biezacy.ostatnieAI) return;
    biezacy.ostatnieAI = { ...biezacy.ostatnieAI, zatwierdzone: true, przed: null };
    biezacy.niezapisane = true; await zapiszTeraz();
    const y = window.scrollY; await ekranProtokol(biezacy.id, biezacy); window.scrollTo(0, y);
  },
  async cofnijAI() {
    if (!confirm('Cofnąć wszystkie zmiany wprowadzone przez AI w tym protokole?')) return;
    AI.cofnijAI(biezacy);
    biezacy.niezapisane = true; await zapiszTeraz();
    pokazKomunikat('Cofnięto zmiany AI');
    const y = window.scrollY; await ekranProtokol(biezacy.id, biezacy); window.scrollTo(0, y);
  },
  async ponowAI() {
    if (!confirm('Wysłać jeszcze raz wszystkie nagrania tego protokołu do AI? (Koszt jak za jedno wypełnienie.)')) return;
    biezacy.transkrypcje = (biezacy.transkrypcje || []).map((tr) => ({ ...tr, ai: 'czeka' }));
    biezacy.niezapisane = true; await zapiszTeraz();
    uruchomAI(biezacy.id);
  },
  async sprawdzAnthropic() {
    const wpisany = document.getElementById('kluczAnthropic').value.trim();
    const klucz = wpisany || (await N.pobierzKlucze(true)).anthropic;
    const wynik = document.getElementById('wynikSprawdzenia');
    if (!klucz) { wynik.innerHTML = '<div class="flaga">Najpierw wklej klucz Anthropic.</div>'; return; }
    wynik.innerHTML = '<p class="info">Sprawdzam…</p>';
    const r = await AI.sprawdzKluczAnthropic(klucz, document.getElementById('modelAI').value.trim() || AI.MODEL_AI_DOMYSLNY);
    wynik.innerHTML = `<div class="${r.ok ? 'karta podpowiedz' : 'flaga'}">${h(r.tekst)}</div>`;
  },
  async ponowNagranie() { await przetworzKolejke({ tezBledy: true }); odswiezNagrania(); },
  async usunNagranie(el) {
    if (!confirm('Usunąć to nagranie? Nie będzie można go już zamienić na tekst.')) return;
    await N.usunNagranie(el.dataset.id);
    odswiezNagrania(); odswiezStanKolejki();
  },
  async zapiszKlucze() {
    const zmiany = {
      modelTranskrypcji: document.getElementById('modelTranskrypcji').value.trim() || N.MODEL_DOMYSLNY,
      modelAI: document.getElementById('modelAI').value.trim() || AI.MODEL_AI_DOMYSLNY,
    };
    const o = document.getElementById('kluczOpenai').value.trim();
    const a = document.getElementById('kluczAnthropic').value.trim();
    const dniO = document.getElementById('openaiDni').value;
    zmiany.openaiWygasa = zaDni(dniO);
    zmiany.anthropicWygasa = zaDni(document.getElementById('anthropicDni').value);
    // Nowy klucz OpenAI bez podanej liczby dni -> domyślnie 90 dni (tak jak ustawiasz w panelu OpenAI).
    if (o) { zmiany.openai = o; if (!dniO.trim()) zmiany.openaiWygasa = zaDni(90); }
    if (a) zmiany.anthropic = a;
    try {
      await N.zapiszKlucze(zmiany);
      pokazKomunikat('Zapisano ✓');
      ekranKlucze();
      przetworzKolejke({ tezBledy: true }); // nagrania, które czekały na klucz
    } catch (e) { alert('Nie udało się zapisać (potrzebny internet).'); }
  },
  async sprawdzOpenai() {
    const wpisany = document.getElementById('kluczOpenai').value.trim();
    const klucz = wpisany || (await N.pobierzKlucze(true)).openai;
    const wynik = document.getElementById('wynikSprawdzenia');
    if (!klucz) { wynik.innerHTML = '<div class="flaga">Najpierw wklej klucz OpenAI.</div>'; return; }
    wynik.innerHTML = '<p class="info">Sprawdzam…</p>';
    const r = await N.sprawdzKluczOpenAI(klucz, document.getElementById('modelTranskrypcji').value.trim() || N.MODEL_DOMYSLNY);
    wynik.innerHTML = `<div class="${r.ok ? 'karta podpowiedz' : 'flaga'}">${h(r.tekst)}</div>`;
  },
  zdjPrzesun(el) {
    const i = +el.dataset.i, j = i + +el.dataset.o;
    if (j < 0 || j >= zdjecia.length) return;
    [zdjecia[i], zdjecia[j]] = [zdjecia[j], zdjecia[i]];
    odswiezZdjecia();
  },
  zdjUsun(el) {
    const [z] = zdjecia.splice(+el.dataset.i, 1);
    if (z && z.mini) URL.revokeObjectURL(z.mini);
    odswiezZdjecia();
  },
  zdjWyczysc() {
    if (!confirm('Usunąć wszystkie zdjęcia z listy? (Zdjęcia w galerii telefonu zostają.)')) return;
    zdjecia.forEach((z) => z.mini && URL.revokeObjectURL(z.mini));
    zdjecia = [];
    odswiezZdjecia();
  },
  async zdjPdf() {
    if (!zdjecia.length) return;
    const b = document.getElementById('przyciskZdjPdf');
    const nazwa = (document.getElementById('nazwaZdjec').value.trim() || 'Zdjecia').replace(/[\\/:*?"<>|]+/g, ' ');
    b.disabled = true;
    try {
      const { zdjeciaDoPdf } = await import('./zdjecia.js');
      let pominiete = 0;
      const bajty = await zdjeciaDoPdf(zdjecia.map((z) => z.plik), (n, w, p) => { pominiete = p; b.textContent = `⏳ Przetwarzam ${n} / ${w}…`; });
      if (pominiete) alert(`Pominięto ${pominiete} plik(ów), których nie udało się odczytać jako zdjęcia.`);
      pokazGotowyPdf(new File([bajty], nazwa.toLowerCase().endsWith('.pdf') ? nazwa : `${nazwa}.pdf`, { type: 'application/pdf' }));
    } catch (e) {
      console.error(e);
      alert('Nie udało się utworzyć PDF: ' + e.message);
    }
    b.disabled = false;
    odswiezZdjecia();
  },
  pdfWszystkie(el) {
    wyborPdf.wybrane = new Set(el.dataset.wartosc ? wyborPdf.protokoly.map((p) => p.id) : []);
    odswiezLicznikPdf();
  },
  pdfPrzeglad(el) {
    const ids = wyborPdf.protokoly.filter((p) => p.przegladId === el.dataset.id).map((p) => p.id);
    const wszystkie = ids.every((i) => wyborPdf.wybrane.has(i));
    ids.forEach((i) => (wszystkie ? wyborPdf.wybrane.delete(i) : wyborPdf.wybrane.add(i)));
    odswiezLicznikPdf();
  },
  async utworzPdf() {
    const wybrane = wyborPdf.protokoly.filter((p) => wyborPdf.wybrane.has(p.id));
    if (!wybrane.length) return pokazKomunikat('Zaznacz co najmniej jeden protokół');
    // Data w nazwie: najnowszy przegląd spośród wybranych protokołów.
    const daty = wyborPdf.przeglady.filter((pg) => wybrane.some((p) => p.przegladId === pg.id)).map((pg) => pg.data).sort();
    await generujPdf(wybrane, nazwaPlikuPdf(wyborPdf.grupa.nazwa, P.dataPL(daty[daty.length - 1])));
  },
  async pdfProtokolu() {
    await zapiszTeraz();
    const pg = await baza.pobierz('przeglady', biezacy.przegladId);
    const grupa = await baza.pobierz('grupy', biezacy.grupaId);
    await generujPdf([biezacy], nazwaPlikuPdf(grupa.nazwa, biezacy.naglowek.oznaczenie || biezacy.naglowek.typ, P.dataPL(pg.data)));
  },
  async zaloguj() {
    const imie = document.getElementById('logImie').value;
    const kod = document.getElementById('logKod').value;
    if (!imie.trim() || kod.replace(/\D/g, '').length !== 6) return ekranLogowania('logowanie', 'Wpisz imię oraz 6 cyfr kodu.');
    try {
      const w = await C.zalogujKodem(imie, kod);
      if (w.stan === 'ok') { pokazKomunikat(`Witaj, ${C.sesja.imie}!`); idzDo('#/'); return pokaz(); }
      ekranLogowania(w.stan);
    } catch (e) {
      ekranLogowania('logowanie', navigator.onLine
        ? 'Nieprawidłowe imię lub kod, albo kod wygasł / został już użyty.'
        : 'Brak internetu – logowanie wymaga połączenia.');
    }
  },
  async zalozAdmina() {
    const imie = document.getElementById('logImie').value;
    if (!imie.trim()) return;
    try {
      await C.zalozPierwszeKonto(imie);
      idzDo('#/'); pokaz();
    } catch (e) {
      ekranLogowania('logowanie', 'Konto administratora już istnieje. Zaloguj się kodem.');
    }
  },
  sprobujPonownie() { startLogowania(); },
  async dodajOsobe() {
    const imie = prompt('Imię nowej osoby (np. „Jan”). Gdy dwie osoby mają to samo imię, dodaj literę nazwiska, np. „Jan K.”:');
    if (!imie || !imie.trim()) return;
    try {
      const id = await C.dodajKonto(imie);
      const k = await C.nowyKod(id);
      ostatniKod = { imie: imie.trim(), ...k };
    } catch (e) { alert(e.message || 'Nie udało się dodać osoby (potrzebny internet).'); }
    ekranUzytkownicy();
  },
  async kodDla(el) {
    try {
      const k = await C.nowyKod(el.dataset.id);
      ostatniKod = { imie: el.dataset.imie, ...k };
    } catch (e) { alert('Nie udało się utworzyć kodu (potrzebny internet).'); }
    ekranUzytkownicy();
  },
  async przelaczBlokade(el) {
    const blokuj = !!el.dataset.aktywny;
    if (blokuj && !confirm('Zablokować tę osobę? Straci dostęp na wszystkich urządzeniach.')) return;
    try { await C.ustawAktywne(el.dataset.id, !blokuj); } catch (e) { alert('Nie udało się (potrzebny internet).'); }
    ekranUzytkownicy();
  },
  async udostepnijKod() {
    const tekst = `Kod do aplikacji Protokoły: ${ostatniKod.kod}\nImię przy logowaniu: ${ostatniKod.imie}\nAdres: ${location.origin}${location.pathname}\nKod działa jeden raz, ważny do ${godzinaPL(ostatniKod.wazneDo.getTime())}.`;
    if (navigator.share) { try { await navigator.share({ text: tekst }); } catch (e) { /* anulowano */ } }
    else { try { await navigator.clipboard.writeText(tekst); pokazKomunikat('Skopiowano – wklej w SMS'); } catch (e) { alert(tekst); } }
  },
  async nowaGrupa() {
    const nazwa = prompt('Nazwa klienta (grupy), np. „Budimex sp. z o. o.”:');
    if (!nazwa || !nazwa.trim()) return;
    const g = { id: noweId(), nazwa: nazwa.trim(), utworzono: Date.now() };
    await baza.zapisz('grupy', g);
    idzDo(`#/grupa/${g.id}`);
  },
  async zmienNazweGrupy(el) {
    const g = await baza.pobierz('grupy', el.dataset.id);
    const nazwa = prompt('Nowa nazwa grupy:', g.nazwa);
    if (!nazwa || !nazwa.trim()) return;
    g.nazwa = nazwa.trim();
    await baza.zapisz('grupy', g);
    pokazKomunikat('Zmieniono nazwę – pole OBIEKT zmieni się we wszystkich protokołach');
    pokaz();
  },
  async usunGrupe(el) {
    const id = el.dataset.id;
    const g = await baza.pobierz('grupy', id);
    const protokoly = await baza.wgIndeksu('protokoly', 'grupaId', id);
    if (!confirm(`Usunąć grupę „${g.nazwa}” razem z ${protokoly.length} protokołami? Tego nie da się cofnąć.`)) return;
    for (const p of protokoly) await baza.usun('protokoly', p.id);
    for (const pg of await baza.wgIndeksu('przeglady', 'grupaId', id)) await baza.usun('przeglady', pg.id);
    await baza.usun('grupy', id);
    idzDo('#/');
  },
  async nowyPrzeglad(el) {
    const pg = { id: noweId(), grupaId: el.dataset.id, data: P.dzisiaj(), utworzono: Date.now() };
    await baza.zapisz('przeglady', pg);
    idzDo(`#/przeglad/${pg.id}`);
  },
  async usunPrzeglad(el) {
    const id = el.dataset.id;
    const pg = await baza.pobierz('przeglady', id);
    const protokoly = await protokolyPrzegladu(id);
    if (!confirm(`Usunąć przegląd z ${P.dataPL(pg.data)} razem z ${protokoly.length} protokołami?`)) return;
    for (const p of protokoly) await baza.usun('protokoly', p.id);
    await baza.usun('przeglady', id);
    idzDo(`#/grupa/${pg.grupaId}`);
  },
  async nowaCentrala(el) {
    const lista = await protokolyPrzegladu(el.dataset.id);
    const ostatni = lista[lista.length - 1];
    await nowaCentrala(el.dataset.id, ostatni ? { termin: ostatni.termin } : {});
  },
  pokazKandydatow() {
    document.getElementById('kandydaci').classList.toggle('ukryta');
  },
  async kopiujCentrale(el) {
    const zrodlo = await baza.pobierz('protokoly', el.dataset.zrodlo);
    await nowaCentrala(el.dataset.id, { naglowek: { ...zrodlo.naglowek }, sekcje: { ...zrodlo.sekcje } });
  },
  async wezNaglowek(el) {
    const zrodlo = await baza.pobierz('protokoly', el.dataset.zrodlo);
    biezacy.naglowek = { ...zrodlo.naglowek };
    if (!Object.keys(biezacy.sekcje).length) biezacy.sekcje = { ...zrodlo.sekcje };
    biezacy.niezapisane = true;
    await zapiszTeraz();
    pokazKomunikat('Skopiowano dane centrali');
    pokaz();
  },
  async budowaJakPoprzednia(el) {
    const zrodlo = await baza.pobierz('protokoly', el.dataset.zrodlo);
    P.kopiujBudowe(biezacy, zrodlo);
    biezacy.niezapisane = true;
    await zapiszTeraz();
    pokazKomunikat('Skopiowano jest/brak sekcji');
    pokaz();
  },
  sekcjaOK(el) {
    P.sekcjaOK(biezacy, el.dataset.nr);
    odswiezSekcje(el.dataset.nr);
    zapiszZaChwile();
  },
  sekcja(el) {
    P.ustawSekcje(biezacy, el.dataset.nr, el.dataset.wartosc);
    odswiezSekcje(el.dataset.nr);
    zapiszZaChwile();
  },
  punkt(el) {
    P.ustawPunkt(biezacy, el.dataset.nr, el.dataset.stan);
    odswiezSekcje(el.dataset.nr.split('.')[0]);
    zapiszZaChwile();
  },
  dodatkowe(el) {
    P.przelaczDodatkowe(biezacy, el.dataset.nr);
    odswiezSekcje(el.dataset.nr.split('.')[0]);
    zapiszZaChwile();
  },
  // Przewija do pierwszego niezaznaczonego miejsca.
  doBraku() {
    document.querySelector('main').classList.add('pokaz-braki');
    const el = document.querySelector('.sekcja.stan-pusty, .punkt.pusty, .pole.puste');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('mignij');
      setTimeout(() => el.classList.remove('mignij'), 1200);
    }
  },
  async doListy() {
    await zapiszTeraz();
    idzDo(`#/przeglad/${biezacy.przegladId}`);
  },
  async nastepna() {
    await zapiszTeraz();
    pokazKomunikat('Zapisano ✓');
    await nowaCentrala(biezacy.przegladId, { termin: biezacy.termin });
  },
  async usunZListy(el) {
    const p = await baza.pobierz('protokoly', el.dataset.id);
    if (!confirm(`Usunąć protokół „${P.opisCentrali(p)}”? Tego nie da się cofnąć.`)) return;
    await baza.usun('protokoly', p.id);
    pokazKomunikat('Usunięto protokół');
    pokaz();
  },
  async usunProtokol() {
    if (!confirm('Usunąć ten protokół?')) return;
    const przegladId = biezacy.przegladId;
    await baza.usun('protokoly', biezacy.id);
    biezacy = null;
    idzDo(`#/przeglad/${przegladId}`);
  },
};

ekran.addEventListener('click', (e) => {
  const el = e.target.closest('[data-akcja]');
  if (!el || el.tagName === 'INPUT') return;
  const akcja = akcje[el.dataset.akcja];
  if (akcja) { e.preventDefault(); akcja(el); }
});

// Pola tekstowe – zapis w trakcie pisania.
ekran.addEventListener('input', (e) => {
  const el = e.target;
  if (!biezacy) return;
  if (el.dataset.naglowek) {
    biezacy.naglowek[el.dataset.naglowek] = el.value;
    delete biezacy.flagi['naglowek.' + el.dataset.naglowek];
  } else if (el.dataset.poleGlowne) {
    biezacy[el.dataset.poleGlowne] = el.value;
    delete biezacy.flagi[el.dataset.poleGlowne];
  } else if (el.dataset.pole) {
    P.ustawPole(biezacy, el.dataset.nr, el.dataset.pole, el.value);
    if (el.dataset.pole === 'dod') odswiezPrzyciskiPunktu(el.dataset.nr);
    else if (el.closest('.liczby') && !el.dataset.opcjonalne) el.closest('.pole').classList.toggle('puste', !el.value.trim());
  } else return;
  odswiezLicznik();
  zapiszZaChwile();
});

// Zmiana daty przeglądu / zaznaczenie protokołu do PDF.
ekran.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'miesiacKosztow' && el.value) { miesiacKosztow = el.value; ekranKoszty(); return; }
  if (el.id === 'plikKopii' && el.files.length) {
    const plik = el.files[0];
    el.value = '';
    let dane;
    try { dane = JSON.parse(await plik.text()); } catch (e) { alert('To nie jest plik kopii (błędny format).'); return; }
    if (!dane || dane.aplikacja !== 'Protokoły kontroli' || !Array.isArray(dane.protokoly)) { alert('To nie jest plik kopii tej aplikacji.'); return; }
    if (!confirm(`Kopia z ${godzinaPL(Date.parse(dane.utworzono))}: ${dane.grupy.length} grup, ${dane.przeglady.length} przeglądów, ${dane.protokoly.length} protokołów. Przywrócić?`)) return;
    try {
      let partia = C.F.writeBatch(C.fs); let n = 0;
      for (const k of KOLEKCJE_KOPII) {
        for (const d of dane[k] || []) {
          if (!d.id) continue;
          partia.set(C.F.doc(C.fs, k, d.id), d);
          if (++n % 400 === 0) { await partia.commit(); partia = C.F.writeBatch(C.fs); }
        }
      }
      await partia.commit();
      alert(`Przywrócono ${n} wpisów ✓`);
    } catch (e) { console.error(e); alert('Nie udało się przywrócić kopii: ' + e.message); }
    return;
  }
  if (el.id === 'trybTestowy') {
    N.ustawTrybTestowy(el.checked);
    pokazKomunikat(el.checked ? 'Tryb testowy włączony – bez kosztów' : 'Tryb testowy wyłączony');
    return;
  }
  if ((el.id === 'wybierzZdjecia' || el.id === 'zrobZdjecie') && el.files.length) {
    dodajZdjecia(el.files);
    el.value = '';
    return;
  }
  if (el.dataset.pdf && wyborPdf) {
    el.checked ? wyborPdf.wybrane.add(el.dataset.pdf) : wyborPdf.wybrane.delete(el.dataset.pdf);
    odswiezLicznikPdf();
    return;
  }
  if (el.dataset.akcja === 'dataPrzegladu' && el.value) {
    const pg = await baza.pobierz('przeglady', el.dataset.id);
    pg.data = el.value;
    await baza.zapisz('przeglady', pg);
    pokazKomunikat('Zmieniono datę przeglądu');
  }
});

// Zapis przy wyjściu z aplikacji / przełączeniu na inną.
document.addEventListener('visibilitychange', () => { if (document.hidden) zapiszTeraz(); });

// ------------------------------------------------------------
// Przełączanie ekranów
// ------------------------------------------------------------
async function pokaz() {
  if (!C.sesja) return startLogowania();
  // Wychodząc z protokołu zapamiętaj, że był już zapisany – przy powrocie braki będą wyróżnione.
  if (biezacy && !location.hash.includes(biezacy.id) && !biezacy.zapisany) {
    biezacy.zapisany = true;
    biezacy.niezapisane = true;
  }
  await zapiszTeraz();
  const [rodzaj, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (rodzaj !== 'protokol') biezacy = null;
  if (rodzaj === 'grupa') await ekranGrupa(id);
  else if (rodzaj === 'przeglad') await ekranPrzeglad(id);
  else if (rodzaj === 'protokol') await ekranProtokol(id);
  else if (rodzaj === 'uzytkownicy') { ostatniKod = null; await ekranUzytkownicy(); }
  else if (rodzaj === 'pdf') await ekranWyboruPdf(id, location.hash.split('/')[3]);
  else if (rodzaj === 'zdjecia') ekranZdjecia();
  else if (rodzaj === 'ustawienia') await ekranUstawienia();
  else if (rodzaj === 'administrator') ekranAdministrator();
  else if (rodzaj === 'klucze') await ekranKlucze();
  else if (rodzaj === 'testai') await ekranTestAI();
  else if (rodzaj === 'koszty') await ekranKoszty();
  else if (rodzaj === 'slownik') await ekranSlownik();
  else if (rodzaj === 'kopia') await ekranKopia();
  else { await ekranGrupy(); odswiezStanKolejki(); ostrzezeniaKluczy(); }
}

window.addEventListener('hashchange', async () => { await pokaz(); window.scrollTo(0, 0); });

przyBledzieZapisu((e) => {
  console.error(e);
  pokazKomunikat(e.code === 'permission-denied' ? '⛔ Brak uprawnień do tej zmiany' : '⚠ Błąd zapisu w chmurze');
});

(async function start() {
  await P.wczytajSzablon();
  poprosOTrwalyZapis();
  await startLogowania();
})();

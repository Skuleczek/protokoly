// ============================================================
// aplikacja.js – ekrany aplikacji.
// Adres po znaku # mówi, który ekran pokazać:
//   #/                      – lista grup (klientów)
//   #/grupa/ID              – przeglądy w grupie
//   #/przeglad/ID           – centrale w przeglądzie
//   #/protokol/ID           – formularz protokołu
//   #/uzytkownicy           – osoby i kody (tylko administrator)
//   #/pdf/przeglad/ID, #/pdf/grupa/ID – wybór protokołów do PDF
// ============================================================

import { baza, noweId, poprosOTrwalyZapis, przyBledzieZapisu } from './baza.js';
import * as P from './protokol.js';
import * as C from './chmura.js';

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
      ${grupy.length ? '' : '<p class="pusto">Nie masz jeszcze żadnej grupy. Dodaj pierwszego klienta.</p>'}
      <ul class="lista">
        ${grupy.map((g) => `
          <li><a class="wiersz" href="#/grupa/${g.id}">
            <span class="tytul">📁 ${h(g.nazwa)}</span>
            <span class="opis">${ile(g.id)} protokołów</span>
          </a></li>`).join('')}
      </ul>
      ${jestAdminem() ? '<div class="opcje"><a class="sredni przycisk-link" href="#/uzytkownicy">👥 Użytkownicy i kody</a></div>' : ''}
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
            <span class="opis">👤 ${h(p.autorImie || '–')}</span>
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

function htmlFlagi(p, klucz) {
  const f = p.flagi && p.flagi[klucz];
  if (!f) return '';
  const nazwa = f.typ === 'uzupelnij' ? 'Do uzupełnienia' : 'Do sprawdzenia';
  return `<div class="flaga">⚠ ${nazwa}${f.cytat ? `: „${h(f.cytat)}”` : ''}</div>`;
}

function htmlPunkt(p, pkt) {
  const w = p.punkty[pkt.nr] || {};
  const flagaPunktu = htmlFlagi(p, pkt.nr);
  if (pkt.typ === 'liczby') {
    return `<div class="punkt">
      <div class="punkt-nazwa"><b>${pkt.nr}.</b> ${h(pkt.nazwa)}</div>
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
    </label>`).join('');
  const pusty = !w.stan && !pkt.opcjonalny;
  return `<div class="punkt ${pusty ? 'pusty' : ''}" data-punkt="${pkt.nr}">
    <div class="punkt-nazwa"><b>${pkt.nr}.</b> ${h(pkt.nazwa)}${pkt.opcjonalny ? ' <span class="opcjonalny">(opcjonalnie)</span>' : ''}</div>
    <div class="rzad">
      <button class="wybor poz ${w.stan === 'poz' ? 'wybrany' : ''}" data-akcja="punkt" data-nr="${pkt.nr}" data-stan="poz">${h(pkt.pozytywna)}</button>
      <button class="wybor neg ${w.stan === 'neg' ? 'wybrany' : ''}" data-akcja="punkt" data-nr="${pkt.nr}" data-stan="neg">${h(pkt.negatywna)}</button>
    </div>
    ${dodatkowe}${tekstowe}${flagaPunktu}
  </div>`;
}

function htmlSekcja(p, s) {
  const stan = p.sekcje[s.nr] || null;
  return `<section class="sekcja ${stan ? 'stan-' + stan : 'stan-pusty'}" id="sekcja-${s.nr}">
    <h3><span class="nr">${s.nr}.</span> ${h(s.nazwa)}</h3>
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

async function ekranProtokol(id) {
  const p = await baza.pobierz('protokoly', id);
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

  const pole = (klucz, etykieta, tryb = 'text') => `<label class="pole">${h(etykieta)}
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

      <p class="autor">👤 Wykonał: <b>${h(p.autorImie || '–')}</b>${p.zmienilImie && p.zmieniono ? ` · ostatnia zmiana: ${h(p.zmienilImie)}, ${godzinaPL(p.zmieniono)}` : ''}</p>
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
        <label class="pole">${h(szablon.stopka.terminPrzegladu)}
          <input type="text" value="${h(p.termin)}" placeholder="np. 05.2027" data-pole-glowne="termin">
          ${htmlFlagi(p, 'termin')}
        </label>
        <label class="pole">${h(szablon.stopka.uwagi)}
          <textarea rows="4" data-pole-glowne="uwagi">${h(p.uwagi)}</textarea>
          ${htmlFlagi(p, 'uwagi')}
        </label>
      </section>

      <button class="sredni" data-akcja="pdfProtokolu">📄 PDF tego protokołu</button>
      ${mozeUsunacProtokol(p) ? '<button class="sredni niebezpieczny" data-akcja="usunProtokol">🗑 Usuń ten protokół</button>' : ''}
    </main>
    <footer class="dolny">
      <button class="duzy" data-akcja="doListy">☰ Lista</button>
      <button class="duzy glowny" data-akcja="nastepna">Zapisz i następna ➜</button>
    </footer>`;
  odswiezLicznik();
}

// ------------------------------------------------------------
// PDF: wybór protokołów i tworzenie pliku
// ------------------------------------------------------------
let wyborPdf = null; // { protokoly, nazwaPliku, wybrane: Set }

const nazwaPlikuPdf = (...czesci) => `${czesci.map((c) => C.idKonta(c)).filter(Boolean).join('_')}.pdf`;

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
  const nazwa = rodzaj === 'przeglad'
    ? nazwaPlikuPdf('Protokoly', grupa.nazwa, przeglady[0].data)
    : nazwaPlikuPdf('Protokoly', grupa.nazwa);
  wyborPdf = { protokoly, nazwaPliku: nazwa, wybrane: new Set(protokoly.map((p) => p.id)) };

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
              <span class="opis">nr fabr. ${h(p.naglowek.nrFabr || '–')} · 👤 ${h(p.autorImie || '–')}
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

function pokazGotowyPdf(plik) {
  const adres = URL.createObjectURL(plik);
  const moznaUdostepnic = navigator.canShare && navigator.canShare({ files: [plik] });
  const okno = document.createElement('div');
  okno.className = 'okno-tlo';
  okno.innerHTML = `<div class="okno">
    <h3>✓ PDF gotowy</h3>
    <p class="info">${h(plik.name)} · ${Math.max(1, Math.round(plik.size / 1024))} KB</p>
    <a class="duzy glowny przycisk-link" href="${adres}" download="${h(plik.name)}" target="_blank">💾 Otwórz / zapisz</a>
    ${moznaUdostepnic ? '<button class="duzy" data-okno="udostepnij">📤 Udostępnij (e-mail, WhatsApp…)</button>' : ''}
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
  if (wynik.stan === 'ok') return pokaz();
  ekranLogowania(wynik.stan);
}

// ------------------------------------------------------------
// EKRAN: użytkownicy (tylko administrator)
// ------------------------------------------------------------
let ostatniKod = null; // { imie, kod, wazneDo } – pokazywany po wygenerowaniu

async function ekranUzytkownicy() {
  if (!jestAdminem()) return idzDo('#/');
  ekran.innerHTML = `<header class="pasek"><a class="wstecz" href="#/">‹</a><h1>Użytkownicy</h1></header>
    <main><p class="pusto">Wczytywanie…</p></main>`;
  let konta;
  try { konta = await C.listaKont(); } catch (e) {
    ekran.querySelector('main').innerHTML = '<p class="pusto">Lista użytkowników wymaga internetu.</p>';
    return;
  }
  const dataG = (d) => godzinaPL(d.getTime());
  ekran.innerHTML = `
    <header class="pasek"><a class="wstecz" href="#/">‹</a><h1>Użytkownicy</h1></header>
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
    await generujPdf(wybrane, wyborPdf.nazwaPliku);
  },
  async pdfProtokolu() {
    await zapiszTeraz();
    const pg = await baza.pobierz('przeglady', biezacy.przegladId);
    const grupa = await baza.pobierz('grupy', biezacy.grupaId);
    await generujPdf([biezacy], nazwaPlikuPdf('Protokol', grupa.nazwa, biezacy.naglowek.oznaczenie || biezacy.naglowek.typ, pg.data));
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
  else await ekranGrupy();
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

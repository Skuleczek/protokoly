// ============================================================
// aplikacja.js – ekrany aplikacji.
// Adres po znaku # mówi, który ekran pokazać:
//   #/                      – lista grup (klientów)
//   #/grupa/ID              – przeglądy w grupie
//   #/przeglad/ID           – centrale w przeglądzie
//   #/protokol/ID           – formularz protokołu
// ============================================================

import { baza, noweId, poprosOTrwalyZapis } from './baza.js';
import * as P from './protokol.js';

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
      <button class="duzy glowny" data-akcja="nowaGrupa">＋ Nowa grupa (klient)</button>
      ${grupy.length ? '' : '<p class="pusto">Nie masz jeszcze żadnej grupy. Dodaj pierwszego klienta.</p>'}
      <ul class="lista">
        ${grupy.map((g) => `
          <li><a class="wiersz" href="#/grupa/${g.id}">
            <span class="tytul">📁 ${h(g.nazwa)}</span>
            <span class="opis">${ile(g.id)} protokołów</span>
          </a></li>`).join('')}
      </ul>
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
        <button class="sredni" data-akcja="zmienNazweGrupy" data-id="${id}">✎ Zmień nazwę grupy</button>
        <button class="sredni niebezpieczny" data-akcja="usunGrupe" data-id="${id}">🗑 Usuń grupę</button>
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
          return `<li><a class="wiersz" href="#/protokol/${p.id}">
            <span class="tytul">${i + 1}. ${h(P.opisCentrali(p))}</span>
            <span class="opis">nr fabr. ${h(p.naglowek.nrFabr || '–')} ${plakietka}</span>
          </a></li>`;
        }).join('')}
      </ul>
      <div class="opcje">
        <button class="sredni" disabled title="Etap 2">📄 Pobierz PDF (wkrótce)</button>
        <button class="sredni niebezpieczny" data-akcja="usunPrzeglad" data-id="${id}">🗑 Usuń przegląd</button>
      </div>
    </main>`;
}

// ------------------------------------------------------------
// EKRAN: formularz protokołu
// ------------------------------------------------------------
let biezacy = null;        // protokół otwarty w formularzu
let czasomierzZapisu = null;

function zapiszZaChwile() {
  clearTimeout(czasomierzZapisu);
  czasomierzZapisu = setTimeout(zapiszTeraz, 400);
}
async function zapiszTeraz() {
  clearTimeout(czasomierzZapisu);
  if (!biezacy) return;
  biezacy.zmieniono = Date.now();
  await baza.zapisz('protokoly', biezacy);
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
        ${pkt.pola.map((pole) => `<label class="pole maly ${!String(w[pole.id] ?? '').trim() ? 'puste' : ''}">${h(pole.etykieta)}
          <input type="text" inputmode="decimal" value="${h(w[pole.id] ?? '')}" data-pole="${pole.id}" data-nr="${pkt.nr}">
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

      <button class="sredni niebezpieczny" data-akcja="usunProtokol">🗑 Usuń ten protokół</button>
    </main>
    <footer class="dolny">
      <button class="duzy" data-akcja="doListy">☰ Lista</button>
      <button class="duzy glowny" data-akcja="nastepna">Zapisz i następna ➜</button>
    </footer>`;
  odswiezLicznik();
}

// ------------------------------------------------------------
// Obsługa dotknięć (jedno miejsce dla wszystkich przycisków)
// ------------------------------------------------------------
async function nowaCentrala(przegladId, zmiany = {}) {
  const przeglad = await baza.pobierz('przeglady', przegladId);
  const p = P.nowyProtokol(przeglad, zmiany);
  await baza.zapisz('protokoly', p);
  idzDo(`#/protokol/${p.id}`);
}

const akcje = {
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
    await zapiszTeraz();
    pokazKomunikat('Skopiowano dane centrali');
    pokaz();
  },
  async budowaJakPoprzednia(el) {
    const zrodlo = await baza.pobierz('protokoly', el.dataset.zrodlo);
    P.kopiujBudowe(biezacy, zrodlo);
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
    else if (el.closest('.liczby')) el.closest('.pole').classList.toggle('puste', !el.value.trim());
  } else return;
  odswiezLicznik();
  zapiszZaChwile();
});

// Zmiana daty przeglądu.
ekran.addEventListener('change', async (e) => {
  const el = e.target;
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
  // Wychodząc z protokołu zapamiętaj, że był już zapisany – przy powrocie braki będą wyróżnione.
  if (biezacy && !location.hash.includes(biezacy.id)) biezacy.zapisany = true;
  await zapiszTeraz();
  const [rodzaj, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (rodzaj !== 'protokol') biezacy = null;
  if (rodzaj === 'grupa') await ekranGrupa(id);
  else if (rodzaj === 'przeglad') await ekranPrzeglad(id);
  else if (rodzaj === 'protokol') await ekranProtokol(id);
  else await ekranGrupy();
}

window.addEventListener('hashchange', async () => { await pokaz(); window.scrollTo(0, 0); });

(async function start() {
  await P.wczytajSzablon();
  poprosOTrwalyZapis();
  await pokaz();
})();

// ============================================================
// ai.js – Claude wypełnia protokół na podstawie transkrypcji nagrań.
//
// - Instrukcja (zasady interpretacji), szablon i słownik są STAŁE,
//   więc trafiają do pamięci podręcznej Anthropic (prompt caching):
//   kolejne protokoły płacą za nie ok. 5% normalnej ceny.
// - Odpowiedź ma ściśle określony format (schemat JSON) – Claude może
//   zwrócić tylko istniejące punkty i dozwolone wartości.
// - Oznaczenia „AI” i „do sprawdzenia” są tylko w aplikacji, NIE w PDF.
// ============================================================

import { Anthropic } from '../lib/anthropic.js';
import { pobierzSzablon, dataPL } from './protokol.js';

export const MODEL_AI_DOMYSLNY = 'claude-sonnet-5-5';

// ------------------------------------------------------------
// Instrukcja systemowa (stała – buforowana)
// ------------------------------------------------------------
const POTOCZNIE = {
  1: 'nawiew, sekcja nawiewna, wentylator nawiewny',
  2: 'wywiew, sekcja wywiewna, wentylator wywiewny',
  3: 'przepustnice, komora mieszania, recyrkulacja',
  4: 'filtry wstępne, filtry nawiewu (wstępne), G4/M5 na nawiewie',
  5: 'filtry wtórne, filtry dokładne nawiewu, F7/F9/ePM1',
  6: 'filtry wywiewu, filtry na wywiewie',
  7: 'nagrzewnica wodna, wodna, frost/termostat przeciwzamrożeniowy (7.2)',
  8: 'nagrzewnica elektryczna, elektryczna, grzałki',
  9: 'chłodnica, chłodzenie, freon/DX/woda lodowa',
  10: 'glikol, wymiennik glikolowy',
  11: 'rotor, wymiennik obrotowy/rotacyjny, koło',
  12: 'krzyżak, wymiennik krzyżowy/płytowy, rekuperator płytowy',
  13: 'automatyka, sterownik, szafa sterownicza',
};

function opisSzablonu(sz) {
  const linie = [];
  for (const s of sz.sekcje) {
    linie.push(`\nSEKCJA ${s.nr}. ${s.nazwa} – stan: "jest" albo "brak". Potocznie: ${POTOCZNIE[s.nr] || s.skrot}.`);
    for (const p of s.punkty) {
      if (p.typ === 'liczby') {
        const pola = p.pola.map((pl) => `"${pl.id}" = ${pl.etykieta}${pl.opcjonalne ? ' (opcjonalne – nie oznaczaj braku)' : ''}`).join('; ');
        linie.push(`  ${p.nr}. ${p.nazwa} – POLA LICZBOWE: ${pola}`);
        continue;
      }
      let t = `  ${p.nr}. ${p.nazwa} – "poz" = ${p.pozytywna}, "neg" = ${p.negatywna}`;
      if (p.dodatkowe && p.dodatkowe.typ === 'zaznacz') t += `; kratka „${p.dodatkowe.etykieta}” (do_wymiany_lub_czyszczenia)`;
      if (p.dodatkowe && p.dodatkowe.typ === 'wartosc') t += `; pole „${p.dodatkowe.etykieta}” (nastawa, tekst z jednostką)`;
      if (p.polaTekstowe) t += `; pole „${p.polaTekstowe.map((x) => x.etykieta).join(', ')}” (rozmiar)`;
      if (p.opcjonalny) t += ' [PUNKT OPCJONALNY – zaznaczaj tylko, gdy wprost o nim mowa' + (p.dodatkowe && p.dodatkowe.typ === 'wartosc' ? ' albo podano nastawę (wtedy "poz", chyba że powiedziano o zastrzeżeniach)' : '') + ']';
      linie.push(t);
    }
  }
  return linie.join('\n');
}

export function instrukcjaSystemowa(slownik) {
  const sz = pobierzSzablon();
  return `Jesteś asystentem serwisanta central wentylacyjnych. Na podstawie transkrypcji jego swobodnej wypowiedzi (po polsku, język potoczny, skróty branżowe, błędy rozpoznawania mowy) wypełniasz protokół „${sz.nazwa}”. Zwracasz WYŁĄCZNIE zmiany wynikające z wypowiedzi, w podanym formacie JSON.

# SZABLON PROTOKOŁU
Nagłówek: typ (TYP CENTRALI), nrFabr (NR. FABR.), rok (ROK PRODUKCJI), oznaczenie (OZNACZENIE), pomieszczenie (POMIESZCZENIE / PIĘTRO – opcjonalne, gdzie stoi centrala, np. „-1”, „piętro 2”, „kotłownia”). Pole OBIEKT uzupełnia aplikacja – nie zwracaj go.
${opisSzablonu(sz)}

Stopka: termin (Termin następnego przeglądu), uwagi (Uwagi i zalecenia).

# ZASADY INTERPRETACJI (bardzo ważne)
1. CAŁA SEKCJA BEZ ZASTRZEŻEŃ: gdy serwisant mówi o całej sekcji, że jest sprawna/OK/w porządku (np. „sekcja wentylatora nawiewnego sprawna”, „nawiew ok”), zwróć sekcję ze stanem "jest" ORAZ stan "poz" dla WSZYSTKICH punktów wyboru tej sekcji – z wyjątkiem punktów opcjonalnych (oznaczonych [PUNKT OPCJONALNY]), które zaznaczasz tylko, gdy wprost o nich mowa. Pól liczbowych NIE wypełniaj z samej oceny sekcji.
2. WYJĄTKI NADPISUJĄ REGUŁĘ SEKCJI: „nawiewna sprawna, ale łożyska do wymiany” → 1.1–1.3 "poz", 1.5 "neg" + do_wymiany_lub_czyszczenia = true; 1.4 tylko jeśli o nim mowa.
3. BRAK SEKCJI: „sekcja X brak”, „nie ma nagrzewnicy elektrycznej”, „bez rotora” → sekcja ze stanem "brak". Nie zwracaj żadnych punktów ani liczb tej sekcji.
4. LICZBY: pól liczbowych (prądy, nastawy, nastawa bezpiecznika) NIGDY nie zgaduj ani nie wyliczaj. Wpisuj tylko wartości wprost podane. Zapis z przecinkiem dziesiętnym („trzy przecinek dwa” → "3,2"), bez jednostki w polach prądów [A]. Nastawę wpisuj z jednostką, jeśli padła („250 paskali” → "250 Pa", „pięć stopni” → "5°C"). Jeżeli sekcja ma stan "jest", a nie podano wymaganej (nieopcjonalnej) wartości liczbowej – dodaj do do_sprawdzenia wpis typu "uzupelnij" dla tego pola (cytat: pusty tekst). Nie oznaczaj braku pól opcjonalnych.
5. JĘZYK POTOCZNY I SKRÓTY: „presostat ok” → punkt presostatu "poz" w sekcji, o której właśnie mowa; „frost ok” → 7.2 "poz"; „filtry wymienione” → punkt „Wymiana filtrów” = "poz" (tak) we wskazanej sekcji filtrów; „filtry brudne/zapchane” → „Stan filtrów” = "neg" (zanieczyszczone); „do wymiany” przy filtrach/łożyskach/grzałkach/pasku → do_wymiany_lub_czyszczenia = true i stan "neg"; „lamele brudne, do mycia” → "neg" + do_wymiany_lub_czyszczenia = true.
6. NIEJASNE = NIE ZGADUJ: jeśli nie wiadomo, którego punktu/sekcji dotyczy wypowiedź, albo ocena jest dwuznaczna (np. „filtry wymienione”, a jest kilka sekcji filtrów i nie wiadomo których), NIE zmieniaj tego pola – dodaj wpis do do_sprawdzenia z typem "sprawdz" i DOSŁOWNYM cytatem fragmentu wypowiedzi.
7. NAGŁÓWEK, TERMIN, UWAGI: nagłówek wpisuj tylko, gdy podany (typ centrali, nr fabryczny, rok produkcji, oznaczenie, np. „NW1”, pomieszczenie/piętro: piętro zapisuj liczbą, np. „piętro minus jeden” → "-1", „parter” → "0", „drugie piętro” → "2"; nazwę pomieszczenia zwięźle, np. "kotłownia"; gdy podano oba – "-1, kotłownia"). Termin następnego przeglądu w formacie MM.RRRR (np. „maj przyszłego roku” przy dacie kontroli 17.11.2026 → "05.2027"; „za pół roku” → licz od daty kontroli). Uwagi i zalecenia redaguj w poprawnym, rzeczowym stylu protokołu (pełne zdania, bez potocznych zwrotów), np. „Zalecana wymiana łożysk silnika wentylatora nawiewnego.”. Jeżeli protokół ma już uwagi, zwróć PEŁNY nowy tekst uwag: dotychczasowe + nowe (bez powtórzeń), chyba że serwisant każe coś usunąć lub zmienić. Gdy o uwagach nie było mowy – zwróć null.
8. KOLEJNE NAGRANIA: dostajesz aktualny stan protokołu. Zwracaj tylko to, co wynika z nowych nagrań; późniejsza wypowiedź nadpisuje wcześniejszą i obecny stan („jednak łożyska sprawne” → 1.5 "poz", do_wymiany_lub_czyszczenia = false). Nie powtarzaj pól, o których nie było mowy.
9. Pola obiektów, o których nie było mowy, ustaw na null. Nie wymyślaj informacji, których nie ma w wypowiedzi.
10. podsumowanie: 1–2 krótkie zdania po polsku, co zostało uzupełnione.

# SŁOWNIK TERMINÓW (nazwy producentów, skróty, żargon)
${slownik.join(', ')}`;
}

// ------------------------------------------------------------
// Schemat odpowiedzi (generowany z szablonu)
// ------------------------------------------------------------
const tekstLubNull = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const obiekt = (wlasciwosci) => ({
  type: 'object', additionalProperties: false, required: Object.keys(wlasciwosci), properties: wlasciwosci,
});

export function kluczePol() {
  const sz = pobierzSzablon();
  const klucze = ['naglowek.typ', 'naglowek.nrFabr', 'naglowek.rok', 'naglowek.oznaczenie', 'naglowek.pomieszczenie', 'termin', 'uwagi'];
  for (const s of sz.sekcje) {
    klucze.push(s.nr);
    for (const p of s.punkty) {
      if (p.typ === 'liczby') { p.pola.forEach((pl) => klucze.push(`${p.nr}.${pl.id}`)); continue; }
      klucze.push(p.nr);
      if (p.dodatkowe && p.dodatkowe.typ === 'wartosc') klucze.push(`${p.nr}.dod`);
      (p.polaTekstowe || []).forEach((pl) => klucze.push(`${p.nr}.${pl.id}`));
    }
  }
  return klucze;
}

export function schematOdpowiedzi() {
  const sz = pobierzSzablon();
  const punkty = sz.sekcje.flatMap((s) => s.punkty);
  return obiekt({
    naglowek: obiekt({ typ: tekstLubNull, nrFabr: tekstLubNull, rok: tekstLubNull, oznaczenie: tekstLubNull, pomieszczenie: tekstLubNull }),
    sekcje: { type: 'array', items: obiekt({
      nr: { type: 'string', enum: sz.sekcje.map((s) => s.nr) },
      stan: { type: 'string', enum: ['jest', 'brak'] },
    }) },
    punkty: { type: 'array', items: obiekt({
      nr: { type: 'string', enum: punkty.filter((p) => p.typ === 'wybor').map((p) => p.nr) },
      stan: { anyOf: [{ type: 'string', enum: ['poz', 'neg'] }, { type: 'null' }] },
      do_wymiany_lub_czyszczenia: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
      nastawa: tekstLubNull,
      rozmiar: tekstLubNull,
    }) },
    liczby: { type: 'array', items: obiekt({
      nr: { type: 'string', enum: punkty.filter((p) => p.typ === 'liczby').map((p) => p.nr) },
      pole: { type: 'string', enum: ['pobor', 'znamionowy', 'bezpiecznik'] },
      wartosc: { type: 'string' },
    }) },
    termin: tekstLubNull,
    uwagi: tekstLubNull,
    do_sprawdzenia: { type: 'array', items: obiekt({
      pole: { type: 'string', enum: kluczePol() },
      typ: { type: 'string', enum: ['uzupelnij', 'sprawdz'] },
      cytat: { type: 'string' },
    }) },
    podsumowanie: { type: 'string' },
  });
}

// ------------------------------------------------------------
// Wywołanie Claude
// ------------------------------------------------------------
export class BladAI extends Error {
  constructor(komunikat, { ponawiaj = true } = {}) { super(komunikat); this.ponawiaj = ponawiaj; }
}

// Zwięzły obraz aktualnego stanu protokołu (tylko wypełnione pola).
function stanProtokolu(p) {
  const punkty = {};
  for (const [nr, w] of Object.entries(p.punkty || {})) {
    const czyste = Object.fromEntries(Object.entries(w).filter(([k, v]) => k !== 'auto' && v !== null && v !== '' && v !== false && v !== undefined));
    if (Object.keys(czyste).length) punkty[nr] = czyste;
  }
  return {
    naglowek: p.naglowek,
    sekcje: Object.fromEntries(Object.entries(p.sekcje || {}).filter(([, v]) => v)),
    punkty,
    termin: p.termin || '',
    uwagi: p.uwagi || '',
  };
}

const WYNIK_TESTOWY = {
  naglowek: { typ: null, nrFabr: null, rok: null, oznaczenie: null, pomieszczenie: null },
  sekcje: [{ nr: '1', stan: 'jest' }, { nr: '2', stan: 'jest' }, { nr: '8', stan: 'brak' }, { nr: '4', stan: 'jest' }],
  punkty: [
    ...['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '2.5'].map((nr) => ({ nr, stan: 'poz', do_wymiany_lub_czyszczenia: null, nastawa: null, rozmiar: null })),
    { nr: '1.5', stan: 'neg', do_wymiany_lub_czyszczenia: true, nastawa: null, rozmiar: '6205' },
    { nr: '4.3', stan: 'poz', do_wymiany_lub_czyszczenia: null, nastawa: null, rozmiar: null },
  ],
  liczby: [{ nr: '1.6', pole: 'pobor', wartosc: '3,2' }, { nr: '1.6', pole: 'znamionowy', wartosc: '4,1' }],
  termin: '05.2027',
  uwagi: 'Zalecana wymiana łożysk silnika wentylatora nawiewnego (6205). Wymieniono filtry wstępne.',
  do_sprawdzenia: [
    { pole: '2.6.pobor', typ: 'uzupelnij', cytat: '' },
    { pole: '2.6.znamionowy', typ: 'uzupelnij', cytat: '' },
    { pole: '4.1', typ: 'sprawdz', cytat: 'filtry wstępne wymienione' },
  ],
  podsumowanie: 'TRYB TESTOWY: nawiew i wywiew sprawne, łożyska nawiewu do wymiany, brak nagrzewnicy elektrycznej.',
};

/**
 * @returns {Promise<{wynik, zuzycie}>}
 */
export async function wypelnijZNagran(p, transkrypcje, { klucz, model, slownik, testowy }) {
  if (testowy) {
    await new Promise((ok) => setTimeout(ok, 1200));
    return { wynik: JSON.parse(JSON.stringify(WYNIK_TESTOWY)), zuzycie: null };
  }
  if (!klucz) throw new BladAI('Brak klucza Anthropic – administrator musi go wpisać (Administrator → Klucze API).', { ponawiaj: false });

  const klient = new Anthropic({ apiKey: klucz, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const tresc = `Data kontroli: ${dataPL(p.dataKontroli) || 'nieznana'}

Aktualny stan protokołu (JSON):
${JSON.stringify(stanProtokolu(p))}

Nowe nagrania serwisanta (w kolejności – późniejsze mają pierwszeństwo):
${transkrypcje.map((t, i) => `${i + 1}. „${t.tekst}”`).join('\n')}`;

  let odp;
  try {
    odp = await klient.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // gdy model odmówi – API samo spróbuje modelu zapasowego
      system: [{ type: 'text', text: instrukcjaSystemowa(slownik), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: tresc }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schematOdpowiedzi() } },
    });
  } catch (e) {
    const s = e.status;
    const msg = (e.error && e.error.error && e.error.error.message) || e.message || '';
    if (s === 401) throw new BladAI('Klucz Anthropic jest nieprawidłowy albo wygasł – administrator musi wpisać nowy (Administrator → Klucze API).', { ponawiaj: false });
    if (s === 403) throw new BladAI('Klucz Anthropic nie ma uprawnień do tego modelu.', { ponawiaj: false });
    if (s === 400 && /credit|balance|billing/i.test(msg)) throw new BladAI('Brak środków na koncie Anthropic – trzeba doładować.', { ponawiaj: false });
    if (s === 400 || s === 404) throw new BladAI(`Claude odrzucił zapytanie: ${msg}`, { ponawiaj: false });
    if (s === 429) throw new BladAI('Claude: za dużo zapytań – spróbuję za chwilę.');
    if (!s) throw new BladAI('Brak połączenia z Claude – spróbuję ponownie.');
    throw new BladAI(`Błąd serwera Anthropic (${s}) – spróbuję ponownie.`);
  }

  if (odp.stop_reason === 'refusal') throw new BladAI('Claude odmówił przetworzenia tego nagrania.', { ponawiaj: false });
  if (odp.stop_reason === 'max_tokens') throw new BladAI('Odpowiedź Claude była za długa – spróbuj krótszego nagrania.', { ponawiaj: false });
  const blok = odp.content.find((b) => b.type === 'text');
  let wynik;
  try { wynik = JSON.parse(blok.text); } catch (e) {
    throw new BladAI('Claude zwrócił odpowiedź w złym formacie – spróbuj ponownie.');
  }
  const u = odp.usage || {};
  return {
    wynik,
    zuzycie: {
      model: odp.model || model,
      wejscie: u.input_tokens || 0,
      wyjscie: u.output_tokens || 0,
      cacheOdczyt: u.cache_read_input_tokens || 0,
      cacheZapis: u.cache_creation_input_tokens || 0,
    },
  };
}

// Sprawdza klucz Anthropic i dostępność modelu (bez kosztów).
export async function sprawdzKluczAnthropic(klucz, model) {
  try {
    const klient = new Anthropic({ apiKey: klucz, dangerouslyAllowBrowser: true, maxRetries: 0 });
    await klient.models.retrieve(model);
    return { ok: true, tekst: `✓ Klucz działa, model „${model}” jest dostępny.` };
  } catch (e) {
    if (e.status === 401) return { ok: false, tekst: '✗ Klucz nieprawidłowy albo wygasł.' };
    if (e.status === 404) return { ok: false, tekst: `✗ Klucz działa, ale model „${model}” nie istnieje.` };
    if (!e.status) return { ok: false, tekst: '✗ Brak połączenia z Anthropic.' };
    return { ok: false, tekst: `✗ Anthropic odpowiedział błędem ${e.status}.` };
  }
}

// ------------------------------------------------------------
// Zastosowanie wyniku w protokole
// ------------------------------------------------------------
const POLA_COFANIA = ['naglowek', 'sekcje', 'punkty', 'termin', 'uwagi', 'flagi'];
const kopia = (x) => JSON.parse(JSON.stringify(x ?? null));

/**
 * Nanosi wynik Claude na protokół. Zwraca listę zmienionych kluczy pól.
 * Zapamiętuje stan sprzed zmian w p.ostatnieAI.przed (do „Cofnij”).
 */
export function zastosujWynik(p, wynik) {
  const sz = pobierzSzablon();
  const przed = Object.fromEntries(POLA_COFANIA.map((k) => [k, kopia(p[k])]));
  const zmienione = new Set();
  p.flagi = p.flagi || {};
  const usunFlagi = (klucz) => { for (const k of Object.keys(p.flagi)) if (k === klucz || k.startsWith(klucz + '.')) delete p.flagi[k]; };
  const wpis = (nr) => (p.punkty[nr] = p.punkty[nr] || {});
  const sekcjaPunktu = (nr) => nr.split('.')[0];

  for (const [k, v] of Object.entries(wynik.naglowek || {})) {
    if (v !== null && String(v).trim()) { p.naglowek[k] = String(v).trim(); zmienione.add(`naglowek.${k}`); usunFlagi(`naglowek.${k}`); }
  }
  for (const { nr, stan } of wynik.sekcje || []) {
    p.sekcje[nr] = stan; zmienione.add(nr); usunFlagi(nr);
    if (stan === 'brak') {
      // Sekcja "brak" – podpunkty puste.
      for (const pkt of sz.sekcje.find((s) => s.nr === nr).punkty) { delete p.punkty[pkt.nr]; usunFlagi(pkt.nr); }
    }
  }
  const brakSekcji = (nr) => p.sekcje[sekcjaPunktu(nr)] === 'brak';
  for (const r of wynik.punkty || []) {
    if (brakSekcji(r.nr)) continue;
    const pkt = sz.sekcje.flatMap((s) => s.punkty).find((x) => x.nr === r.nr);
    const w = wpis(r.nr);
    if (r.stan) { w.stan = r.stan; w.auto = false; }
    if (r.do_wymiany_lub_czyszczenia !== null && pkt.dodatkowe && pkt.dodatkowe.typ === 'zaznacz') w.dod = !!r.do_wymiany_lub_czyszczenia;
    if (r.nastawa !== null && String(r.nastawa).trim() && pkt.dodatkowe && pkt.dodatkowe.typ === 'wartosc') {
      w.dod = String(r.nastawa).trim(); zmienione.add(`${r.nr}.dod`); usunFlagi(`${r.nr}.dod`);
      if (pkt.opcjonalny && !w.stan) { w.stan = 'poz'; w.auto = true; }
    }
    if (r.rozmiar !== null && String(r.rozmiar).trim() && pkt.polaTekstowe) w.rozmiar = String(r.rozmiar).trim();
    zmienione.add(r.nr); usunFlagi(r.nr);
    if (!p.sekcje[sekcjaPunktu(r.nr)]) { p.sekcje[sekcjaPunktu(r.nr)] = 'jest'; zmienione.add(sekcjaPunktu(r.nr)); }
  }
  for (const { nr, pole, wartosc } of wynik.liczby || []) {
    if (brakSekcji(nr) || !String(wartosc).trim()) continue;
    wpis(nr)[pole] = String(wartosc).trim(); zmienione.add(`${nr}.${pole}`); usunFlagi(`${nr}.${pole}`);
  }
  if (wynik.termin !== null && String(wynik.termin).trim()) { p.termin = wynik.termin.trim(); zmienione.add('termin'); usunFlagi('termin'); }
  if (wynik.uwagi !== null && String(wynik.uwagi).trim()) { p.uwagi = wynik.uwagi.trim(); zmienione.add('uwagi'); usunFlagi('uwagi'); }

  const flagiAI = [];
  for (const f of wynik.do_sprawdzenia || []) {
    const nrS = sekcjaPunktu(f.pole);
    if (!f.pole.startsWith('naglowek') && !['termin', 'uwagi'].includes(f.pole) && p.sekcje[nrS] === 'brak' && f.pole !== nrS) continue;
    p.flagi[f.pole] = { typ: f.typ, cytat: f.cytat || '' };
    flagiAI.push(f.pole);
  }
  p.ostatnieAI = {
    kiedy: Date.now(), zmienione: [...zmienione], flagi: flagiAI.length, flagiKlucze: flagiAI,
    podsumowanie: wynik.podsumowanie || '', przed, zatwierdzone: false,
  };
  return [...zmienione];
}

// Cofa TYLKO pola zmienione przez AI – ręczne poprawki zrobione później zostają.
export function cofnijAI(p) {
  const a = p.ostatnieAI;
  if (!a || !a.przed) return false;
  const przed = a.przed;
  const sz = pobierzSzablon();
  const przywrocPunkt = (nr) => {
    if (przed.punkty && przed.punkty[nr]) p.punkty[nr] = kopia(przed.punkty[nr]); else delete p.punkty[nr];
  };
  for (const k of a.zmienione) {
    if (k.startsWith('naglowek.')) { const pole = k.slice(9); p.naglowek[pole] = (przed.naglowek || {})[pole] ?? ''; continue; }
    if (k === 'termin' || k === 'uwagi') { p[k] = przed[k] ?? ''; continue; }
    const czesci = k.split('.');
    if (czesci.length === 1) {
      // Sekcja – przy "brak" AI wyczyściło podpunkty, więc przywracamy też je.
      if (przed.sekcje && przed.sekcje[k]) p.sekcje[k] = przed.sekcje[k]; else delete p.sekcje[k];
      if (p.sekcje[k] !== 'brak') {
        for (const pkt of sz.sekcje.find((s) => s.nr === k).punkty) if (!p.punkty[pkt.nr] && przed.punkty && przed.punkty[pkt.nr]) p.punkty[pkt.nr] = kopia(przed.punkty[pkt.nr]);
      }
    } else if (czesci.length === 2) {
      przywrocPunkt(k); // cały punkt (stan, kratka, nastawa, rozmiar)
    } else {
      const nr = czesci.slice(0, 2).join('.');
      const pole = czesci[2];
      if (pole === 'dod') { przywrocPunkt(nr); continue; }
      const stara = przed.punkty && przed.punkty[nr] && przed.punkty[nr][pole];
      p.punkty[nr] = p.punkty[nr] || {};
      if (stara !== undefined) p.punkty[nr][pole] = stara; else delete p.punkty[nr][pole];
    }
  }
  // Oznaczenia dodane przez AI znikają; te, które AI usunęło przy zmienianych polach – wracają.
  for (const k of a.flagiKlucze || []) delete p.flagi[k];
  for (const [k, v] of Object.entries(przed.flagi || {})) if (!p.flagi[k] && a.zmienione.some((z) => k === z || k.startsWith(z + '.'))) p.flagi[k] = v;
  p.ostatnieAI = null;
  return true;
}

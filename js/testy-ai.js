// ============================================================
// testy-ai.js – „Test jakości AI” (ekran administratora).
// Przykładowe wypowiedzi serwisanta + oczekiwany wynik według zasad.
// Każdy scenariusz sprawdza jedną z zasad interpretacji.
// ============================================================

// Sprawdzenia: [opis, funkcja(protokol, wynikAI) => true/false]
const stan = (nr) => (p) => (p.punkty[nr] || {}).stan;
const sek = (nr) => (p) => p.sekcje[nr];
const pole = (nr, k) => (p) => String((p.punkty[nr] || {})[k] ?? '');
const flaga = (klucz, typ) => (p) => !!(p.flagi[klucz] && (!typ || p.flagi[klucz].typ === typ));

export const SCENARIUSZE = [
  {
    nazwa: 'Cała sekcja sprawna',
    zasada: 'Sekcja OK → „jest” + wszystkie punkty pozytywne (bez opcjonalnych i bez liczb)',
    tekst: 'Sekcja wentylatora nawiewnego sprawna.',
    sprawdz: [
      ['sekcja 1 = jest', (p) => sek('1')(p) === 'jest'],
      ['1.1, 1.2, 1.3, 1.5 = pozytywne', (p) => ['1.1', '1.2', '1.3', '1.5'].every((n) => stan(n)(p) === 'poz')],
      ['1.4 (opcjonalny) puste', (p) => !stan('1.4')(p)],
      ['prądy 1.6 niewpisane', (p) => !pole('1.6', 'pobor')(p) && !pole('1.6', 'znamionowy')(p)],
      ['1.6 oznaczone „do uzupełnienia”', (p) => flaga('1.6.pobor', 'uzupelnij')(p) && flaga('1.6.znamionowy', 'uzupelnij')(p)],
    ],
  },
  {
    nazwa: 'Wyjątek w sprawnej sekcji',
    zasada: 'Wyjątki nadpisują regułę sekcji',
    tekst: 'Nawiew sprawny, ale łożyska do wymiany.',
    sprawdz: [
      ['1.1–1.3 pozytywne', (p) => ['1.1', '1.2', '1.3'].every((n) => stan(n)(p) === 'poz')],
      ['1.5 bez sprawne/niesprawne', (p) => !stan('1.5')(p)],
      ['1.5 „do wymiany” zaznaczone', (p) => (p.punkty['1.5'] || {}).dod === true],
    ],
  },
  {
    nazwa: 'Łożyska niesprawne',
    zasada: '„niesprawne” zaznacza tylko niesprawne, bez „do wymiany”',
    tekst: 'Na wywiewie łożyska niesprawne.',
    sprawdz: [
      ['2.5 = niesprawne', (p) => stan('2.5')(p) === 'neg'],
      ['2.5 „do wymiany” niezaznaczone', (p) => (p.punkty['2.5'] || {}).dod !== true],
    ],
  },
  {
    nazwa: 'Łożyska do wymiany po sprawnej sekcji',
    zasada: '„do wymiany” odznacza wcześniejsze „sprawne”, rozmiar gdy podany',
    stanPoczatkowy: { sekcje: { 2: 'jest' }, punkty: { 2.1: { stan: 'poz' }, 2.2: { stan: 'poz' }, 2.3: { stan: 'poz' }, 2.5: { stan: 'poz' } } },
    tekst: 'Łożyska na wywiewie do wymiany, rozmiar 6204.',
    sprawdz: [
      ['2.5 bez sprawne/niesprawne', (p) => !stan('2.5')(p)],
      ['2.5 „do wymiany” zaznaczone', (p) => (p.punkty['2.5'] || {}).dod === true],
      ['2.5 rozmiar = 6204', (p) => pole('2.5', 'rozmiar')(p).replace(/\s/g, '') === '6204'],
      ['2.1 nadal sprawne', (p) => stan('2.1')(p) === 'poz'],
    ],
  },
  {
    nazwa: 'Brak sekcji',
    zasada: '„brak” → podpunkty puste',
    tekst: 'Nie ma nagrzewnicy elektrycznej, chłodnicy też brak.',
    sprawdz: [
      ['sekcja 8 = brak', (p) => sek('8')(p) === 'brak'],
      ['sekcja 9 = brak', (p) => sek('9')(p) === 'brak'],
      ['podpunkty 8.x i 9.x puste', (p) => !Object.keys(p.punkty).some((k) => k.startsWith('8.') || k.startsWith('9.'))],
    ],
  },
  {
    nazwa: 'Liczby podane',
    zasada: 'Wpisuje tylko podane liczby, z przecinkiem',
    tekst: 'Wywiew ok, prąd trzy przecinek osiem, znamionowy pięć dwa, bezpiecznik sześć ampery.',
    sprawdz: [
      ['2.6 pobór = 3,8', (p) => pole('2.6', 'pobor')(p).replace('.', ',') === '3,8'],
      ['2.6 znamionowy = 5,2', (p) => pole('2.6', 'znamionowy')(p).replace('.', ',') === '5,2'],
      ['2.6 bezpiecznik = 6', (p) => /^6([,.]0+)?$/.test(pole('2.6', 'bezpiecznik')(p))],
      ['sekcja 2 = jest', (p) => sek('2')(p) === 'jest'],
    ],
  },
  {
    nazwa: 'Liczby niepodane',
    zasada: 'Nigdy nie zgaduje liczb – oznacza do uzupełnienia',
    tekst: 'Nawiew sprawny, prąd w normie.',
    sprawdz: [
      ['1.6 bez wymyślonych wartości', (p) => !pole('1.6', 'pobor')(p) && !pole('1.6', 'znamionowy')(p)],
      ['1.6 pobór oznaczony do uzupełnienia/sprawdzenia', (p) => flaga('1.6.pobor')(p)],
    ],
  },
  {
    nazwa: 'Presostat z nastawą',
    zasada: 'Punkt opcjonalny + nastawa z jednostką',
    tekst: 'Na nawiewie presostat zadziałał poprawnie, nastawa dwieście pięćdziesiąt paskali.',
    sprawdz: [
      ['1.4 = poprawne', (p) => stan('1.4')(p) === 'poz'],
      ['1.4 nastawa zawiera 250', (p) => /250/.test(pole('1.4', 'dod')(p))],
    ],
  },
  {
    nazwa: 'Niejasne filtry',
    zasada: 'Niejasne → nie zgaduje, oznacza „do sprawdzenia” z cytatem',
    stanPoczatkowy: { sekcje: { 4: 'jest', 5: 'jest', 6: 'jest' } },
    tekst: 'Filtry wymienione.',
    sprawdz: [
      ['nie zaznaczył na ślepo wszystkich „Wymiana filtrów”', (p) => !(stan('4.3')(p) === 'poz' && stan('5.3')(p) === 'poz' && stan('6.3')(p) === 'poz') || Object.values(p.flagi).some((f) => f.typ === 'sprawdz')],
      ['jest oznaczenie „do sprawdzenia”', (p) => Object.values(p.flagi).some((f) => f.typ === 'sprawdz')],
    ],
  },
  {
    nazwa: 'Żargon: frost i lamele',
    zasada: 'Rozumie skróty serwisantów',
    tekst: 'Wodna: frost ok, nastawa pięć stopni, lamele brudne, do mycia.',
    sprawdz: [
      ['7.2 = poprawne', (p) => stan('7.2')(p) === 'poz'],
      ['7.2 nastawa zawiera 5', (p) => /5/.test(pole('7.2', 'dod')(p))],
      ['7.1 = zanieczyszczony', (p) => stan('7.1')(p) === 'neg'],
      ['7.1 „do wyczyszczenia”', (p) => (p.punkty['7.1'] || {}).dod === true],
    ],
  },
  {
    nazwa: 'Żargon: rotor',
    zasada: 'Sekcja potocznie + wyjątek',
    tekst: 'Rotor sprawny, tylko pasek do wymiany.',
    sprawdz: [
      ['sekcja 11 = jest', (p) => sek('11')(p) === 'jest'],
      ['11.2 = dostateczny + do wymiany', (p) => stan('11.2')(p) === 'neg' && (p.punkty['11.2'] || {}).dod === true],
      ['11.1, 11.3, 11.4 pozytywne', (p) => ['11.1', '11.3', '11.4'].every((n) => stan(n)(p) === 'poz')],
    ],
  },
  {
    nazwa: 'Nagłówek',
    zasada: 'Typ, nr fabryczny, rok, oznaczenie, piętro z wypowiedzi',
    tekst: 'Centrala Klimor, numer fabryczny jeden dwa trzy cztery pięć, rok dwa tysiące osiemnasty, oznaczenie NW trzy, stoi na piętrze minus jeden.',
    sprawdz: [
      ['typ zawiera Klimor', (p) => /klimor/i.test(p.naglowek.typ)],
      ['nr fabr. = 12345', (p) => p.naglowek.nrFabr.replace(/\s/g, '') === '12345'],
      ['rok = 2018', (p) => p.naglowek.rok.trim() === '2018'],
      ['oznaczenie = NW3', (p) => p.naglowek.oznaczenie.replace(/\s/g, '').toUpperCase() === 'NW3'],
      ['pomieszczenie = -1', (p) => String(p.naglowek.pomieszczenie || '').replace(/\s/g, '').replace('−', '-') === '-1'],
    ],
  },
  {
    nazwa: 'Poprawka w kolejnym nagraniu',
    zasada: 'Późniejsza wypowiedź nadpisuje stan',
    stanPoczatkowy: { sekcje: { 1: 'jest' }, punkty: { 1.5: { stan: 'neg', dod: true } } },
    tekst: 'Jednak łożyska na nawiewie są sprawne.',
    sprawdz: [
      ['1.5 = sprawne', (p) => stan('1.5')(p) === 'poz'],
      ['1.5 „do wymiany” odznaczone', (p) => !(p.punkty['1.5'] || {}).dod],
    ],
  },
  {
    nazwa: 'Termin względny',
    zasada: 'Termin liczony od daty kontroli (17.11.2026)',
    tekst: 'Następny przegląd za pół roku.',
    sprawdz: [['termin = 05.2027', (p) => p.termin.trim() === '05.2027']],
  },
  {
    nazwa: 'Redagowanie uwag',
    zasada: 'Uwagi w rzeczowym stylu, bez potocznych zwrotów',
    tekst: 'Dopisz w uwagach, że trzeba będzie przy następnej wizycie wymienić ten pasek w rotorze bo już ledwo zipie.',
    sprawdz: [
      ['uwagi wpisane', (p) => p.uwagi.trim().length > 10],
      ['bez „dopisz”/„zipie”', (p) => !/dopisz|zipie/i.test(p.uwagi)],
      ['dotyczy paska rotora', (p) => /pas/i.test(p.uwagi)],
    ],
  },
];

// Pusty protokół testowy (z ewentualnym stanem początkowym).
export function protokolTestowy(sc) {
  const s = sc.stanPoczatkowy || {};
  return {
    id: 'test', naglowek: { typ: '', nrFabr: '', rok: '', oznaczenie: '', pomieszczenie: '' },
    sekcje: { ...(s.sekcje || {}) }, punkty: JSON.parse(JSON.stringify(s.punkty || {})),
    dataKontroli: '2026-11-17', termin: '', uwagi: '', flagi: {},
  };
}

export function ocen(sc, p) {
  return sc.sprawdz.map(([opis, fn]) => {
    let ok = false;
    try { ok = !!fn(p); } catch (e) { ok = false; }
    return { opis, ok };
  });
}

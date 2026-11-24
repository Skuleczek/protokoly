// ============================================================
// pdf.js – tworzy PDF wyglądający jak oryginalny protokół (xls).
// Wymiary (w punktach, 1 pt = 1/72 cala) zmierzone z wydruku oryginału.
// Kilka protokołów = jeden plik, każdy protokół od nowej strony
// i z własną numeracją ("Strona 1", jakby był osobnym plikiem).
// PDF powstaje w telefonie – działa także bez internetu.
// ============================================================

import { PDFDocument, rgb, fontkit } from '../lib/pdf-lib.js';
import { pobierzSzablon, dataPL } from './protokol.js';

const A4 = [595.28, 841.89];
const CZARNY = rgb(0, 0, 0);

// Kolumny (zmierzone z oryginału)
const K = {
  lewa: 56.7, prawa: 516.7,          // ramka tabeli
  nrPrawa: 74.6, nazwa: 78.2,        // numer punktu (do prawej) i nazwa
  kratka1: 235.3, opis1: 245.5,      // opcja pozytywna
  kratka2: 317.7, opis2: 328.0,      // opcja negatywna
  dod: 400.0, dodSzer: 28.3, opisDod: 430.2, // pole dodatkowe
  szerokie1: [235.3, 309.3], szerokie2: [317.7, 391.7], // pola liczbowe
  kratka: 8.3,
  pomieszczenie: 400.0,              // pomieszczenie/piętro: komórka I2 (kolumna I, jak pole „nastawa”)
  // Podpis autora: po prawej pod tabelą (pod przerwą w dolnej ramce, jak w oryginale),
  // obok „Termin następnego przeglądu” i tekstu o częstotliwości (ten kończy się na x ≈ 404).
  podpis: { x: 410, szer: 128, od: 14, wys: 64 }, // od = odstęp od dolnej ramki tabeli
};
const ROZMIAR = { punkt: 7, naglowek: 8, tytul: 11.5, firma: 7.7, strona: 9.6, stopka: 9 };

let czcionkiBajty = null;
async function wczytajCzcionki() {
  if (!czcionkiBajty) {
    const pliki = { r: 'Regular', b: 'Bold', i: 'Italic', bi: 'BoldItalic' };
    const wpisy = await Promise.all(Object.entries(pliki).map(async ([k, n]) => {
      const odp = await fetch(`lib/czcionki/LiberationSans-${n}.ttf`);
      return [k, await odp.arrayBuffer()];
    }));
    czcionkiBajty = Object.fromEntries(wpisy);
  }
  return czcionkiBajty;
}

// ------------------------------------------------------------
// Rysowanie (współrzędne "od góry strony", jak w arkuszu)
// ------------------------------------------------------------
function rysownik(strona, f) {
  const H = A4[1];
  const t = {
    // Tekst: y = górna krawędź liter.
    tekst(s, x, y, { czc = f.r, roz = ROZMIAR.punkt, wyr = 'lewo', podkr = false, maxSzer = 0 } = {}) {
      s = String(s ?? '');
      if (!s) return 0;
      let r = roz;
      if (maxSzer) while (r > 4.5 && czc.widthOfTextAtSize(s, r) > maxSzer) r -= 0.25;
      if (maxSzer && czc.widthOfTextAtSize(s, r) > maxSzer) {
        while (s.length > 1 && czc.widthOfTextAtSize(s + '…', r) > maxSzer) s = s.slice(0, -1);
        s += '…';
      }
      const szer = czc.widthOfTextAtSize(s, r);
      const xx = wyr === 'prawo' ? x - szer : wyr === 'srodek' ? x - szer / 2 : x;
      const linia = y + r * 0.905; // linia bazowa
      strona.drawText(s, { x: xx, y: H - linia, size: r, font: czc, color: CZARNY });
      if (podkr) {
        strona.drawLine({ start: { x: xx, y: H - linia - r * 0.15 }, end: { x: xx + szer, y: H - linia - r * 0.15 }, thickness: r * 0.07, color: CZARNY });
      }
      return szer;
    },
    prostokat(x, y, w, h, grubosc = 0.6) {
      strona.drawRectangle({ x, y: H - y - h, width: w, height: h, borderColor: CZARNY, borderWidth: grubosc });
    },
    linia(x1, y1, x2, y2, grubosc = 0.6) {
      strona.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: grubosc, color: CZARNY });
    },
    // Kratka; zaznaczona = krzyżyk "X".
    kratka(x, y, zaznaczona, w = K.kratka, h = 8) {
      t.prostokat(x, y - 1, w, h);
      if (zaznaczona) {
        // Krzyżyk zawsze kwadratowy – w szerszej kratce na środku.
        const m = 1.4;
        const x0 = x + (w - K.kratka) / 2;
        t.linia(x0 + m, y - 1 + m, x0 + K.kratka - m, y - 1 + h - m, 1);
        t.linia(x0 + m, y - 1 + h - m, x0 + K.kratka - m, y - 1 + m, 1);
      }
    },
    // Pole z wpisaną wartością (nastawa, prąd).
    pole(x1, x2, y, wartosc) {
      t.prostokat(x1, y - 1, x2 - x1, 8);
      if (String(wartosc ?? '').trim()) {
        t.tekst(String(wartosc).trim(), (x1 + x2) / 2, y - 0.3, { czc: f.b, roz: 6.8, wyr: 'srodek', maxSzer: x2 - x1 - 2 });
      }
    },
  };
  return t;
}

function naglowekStrony(t, f, numer) {
  const sz = pobierzSzablon();
  t.tekst(sz.firma, K.lewa, 23, { czc: f.b, roz: ROZMIAR.firma });
  t.tekst(sz.nazwa, 300.8, 21, { czc: f.b, roz: ROZMIAR.tytul, wyr: 'srodek', podkr: true });
  t.tekst(`Strona ${numer}`, 545.8, 22, { czc: f.b, roz: ROZMIAR.strona, wyr: 'prawo' });
}

// Dzieli tekst na linie o zadanej szerokości.
function zawin(tekst, czc, roz, szer) {
  const linie = [];
  for (const akapit of String(tekst || '').split(/\n/)) {
    let linia = '';
    for (const slowo of akapit.split(/\s+/).filter(Boolean)) {
      const proba = linia ? `${linia} ${slowo}` : slowo;
      if (czc.widthOfTextAtSize(proba, roz) <= szer) linia = proba;
      else { if (linia) linie.push(linia); linia = slowo; }
    }
    linie.push(linia);
  }
  return linie;
}

function rysujProtokol(pdf, f, p, obiekt, podpis = null) {
  const sz = pobierzSzablon();
  let strona = pdf.addPage(A4);
  let t = rysownik(strona, f);
  naglowekStrony(t, f, 1);

  // --- nagłówek centrali
  const n = p.naglowek || {};
  const etykieta = (tekst, x, y, wartosc, maxX) => {
    const w = t.tekst(tekst, x, y, { czc: f.b, roz: ROZMIAR.naglowek });
    t.tekst(wartosc, x + w + 4, y, { czc: f.r, roz: ROZMIAR.naglowek, maxSzer: maxX - (x + w + 4) });
  };
  etykieta('TYP CENTRALI:', 58.5, 43.1, n.typ, 196);
  etykieta('NR. FABR.:', 198.9, 43.1, n.nrFabr, 316);
  etykieta('ROK PRODUKCJI:', 319.5, 43.1, n.rok, 545);
  etykieta('OBIEKT:', 58.5, 54.8, obiekt, 316);
  // Pomieszczenie/piętro (opcjonalne) – w tym samym wierszu, po prawej (komórka I2 oryginału).
  // Długie oznaczenie nie jest zmniejszane – wtedy piętro przesuwa się w prawo.
  const pom = String(n.pomieszczenie || '').trim();
  if (!pom) etykieta('OZNACZENIE:', 319.5, 54.8, n.oznaczenie, 545);
  else {
    const wE = t.tekst('OZNACZENIE:', 319.5, 54.8, { czc: f.b, roz: ROZMIAR.naglowek });
    const ozn = String(n.oznaczenie || '').trim();
    const xOzn = 319.5 + wE + 4;
    const wOzn = Math.min(f.r.widthOfTextAtSize(ozn, ROZMIAR.naglowek), 470 - xOzn);
    t.tekst(ozn, xOzn, 54.8, { czc: f.r, roz: ROZMIAR.naglowek, maxSzer: 470 - xOzn });
    const xPom = Math.max(K.pomieszczenie, xOzn + wOzn + 8);
    t.tekst(pom, xPom, 54.8, { czc: f.r, roz: ROZMIAR.naglowek, maxSzer: 545 - xPom });
  }

  // --- tabela sekcji
  const gora = 65.3;
  let y = 70.1;
  const KROK = 10.62;
  for (const s of sz.sekcje) {
    const stanS = p.sekcje[s.nr];
    t.tekst(`${s.nr}.`, K.nrPrawa, y, { czc: f.b, wyr: 'prawo' });
    t.tekst(s.nazwa, K.nazwa, y, { czc: f.b });
    t.kratka(K.kratka1, y, stanS === 'jest'); t.tekst(s.pozytywna, K.opis1, y);
    t.kratka(K.kratka2, y, stanS === 'brak'); t.tekst(s.negatywna, K.opis2, y);
    y += KROK;
    const pokazWartosci = stanS !== 'brak'; // sekcja "brak" – podpunkty puste

    for (const pkt of s.punkty) {
      const w = (pokazWartosci && p.punkty[pkt.nr]) || {};
      if (pkt.typ === 'liczby') {
        y += 2;
        t.tekst(`${pkt.nr}.`, K.nrPrawa, y, { wyr: 'prawo' });
        t.tekst(pkt.nazwa, K.nazwa, y, { maxSzer: K.kratka1 - K.nazwa - 4 });
        const pola = Object.fromEntries(pkt.pola.map((pl) => [pl.id, w[pl.id]]));
        t.pole(...K.szerokie1, y, pola.pobor);
        t.pole(...K.szerokie2, y, pola.znamionowy);
        if ('bezpiecznik' in pola || pkt.pola.some((pl) => pl.id === 'bezpiecznik')) {
          t.pole(K.dod, K.dod + K.dodSzer, y, pola.bezpiecznik);
          t.tekst('nastawa bezpiecznika', K.opisDod, y);
        }
        y += KROK + 1;
        continue;
      }
      t.tekst(`${pkt.nr}.`, K.nrPrawa, y, { wyr: 'prawo' });
      t.tekst(pkt.nazwa, K.nazwa, y, { maxSzer: K.kratka1 - K.nazwa - 4 });
      // Rozmiar łożyska (pole tekstowe) – wpisywany w kratkę "do wymiany".
      const rozmiar = (pkt.polaTekstowe || []).map((pl) => String(w[pl.id] ?? '').trim()).filter(Boolean).join(' ');
      t.kratka(K.kratka1, y, w.stan === 'poz'); t.tekst(pkt.pozytywna, K.opis1, y);
      t.kratka(K.kratka2, y, w.stan === 'neg'); t.tekst(pkt.negatywna, K.opis2, y);
      const d = pkt.dodatkowe;
      if (d && d.typ === 'zaznacz' && rozmiar) {
        // Kratka z rozmiarem; gdy zaznaczone "do wymiany" – mały krzyżyk z lewej.
        t.prostokat(K.dod, y - 1, K.dodSzer, 8);
        let x0 = K.dod + 1;
        if (w.dod) {
          t.linia(K.dod + 1.2, y + 0.4, K.dod + 5.8, y + 5.6, 0.9);
          t.linia(K.dod + 1.2, y + 5.6, K.dod + 5.8, y + 0.4, 0.9);
          x0 = K.dod + 7;
        }
        const x1 = K.dod + K.dodSzer - 1;
        t.tekst(rozmiar, (x0 + x1) / 2, y - 0.3, { czc: f.b, roz: 6.8, wyr: 'srodek', maxSzer: x1 - x0 });
        t.tekst(d.etykieta, K.opisDod, y);
      } else if (d && d.typ === 'zaznacz') {
        t.kratka(K.dod, y, !!w.dod, K.dodSzer);
        t.tekst(d.etykieta, K.opisDod, y);
      } else if (d && d.typ === 'wartosc') {
        t.pole(K.dod, K.dod + K.dodSzer, y, typeof w.dod === 'string' ? w.dod : '');
        t.tekst(d.etykieta, K.opisDod, y);
      }
      y += KROK;
    }
  }

  // --- ramka tabeli (z przerwą na dole jak w oryginale)
  const dol = y + 11;
  t.linia(K.lewa, gora, K.prawa, gora);
  t.linia(K.lewa, gora, K.lewa, dol);
  t.linia(K.prawa, gora, K.prawa, dol);
  t.linia(K.lewa, dol, 400, dol);
  t.linia(472.7, dol, K.prawa, dol);

  // --- data i podpis (miejsce na podpis odręczny; w przyszłości obrazek podpisu)
  let yS = dol + 2;
  const wEt = t.tekst(sz.stopka.podpis, K.nazwa, yS, { czc: f.bi, roz: 8.5, podkr: true });
  t.tekst(dataPL(p.dataKontroli), K.nazwa + wEt + 8, yS, { roz: 8.5 });
  // Podpis autora protokołu (obrazek PNG z przezroczystym tłem), wpasowany i wyśrodkowany w polu.
  if (podpis) {
    const P = K.podpis;
    const skala = Math.min(P.szer / podpis.width, P.wys / podpis.height);
    const w = podpis.width * skala, wys = podpis.height * skala;
    const x = P.x + (P.szer - w) / 2;
    const yGora = dol + P.od + (P.wys - wys) / 2;
    strona.drawImage(podpis, { x, y: A4[1] - yGora - wys, width: w, height: wys });
  }

  // --- termin, informacja, uwagi
  yS += 20;
  const wT = t.tekst(`${sz.stopka.terminPrzegladu} : `, 58.5, yS, { roz: ROZMIAR.stopka });
  t.tekst(p.termin, 58.5 + wT + 2, yS, { czc: f.b, roz: ROZMIAR.stopka, maxSzer: K.prawa - (58.5 + wT + 2) });
  yS += 22;
  for (const linia of zawin(sz.stopka.informacja, f.r, ROZMIAR.stopka, 345)) {
    t.tekst(linia, 58.5, yS, { roz: ROZMIAR.stopka });
    yS += 11.1;
  }
  yS += 11;
  t.tekst(`${sz.stopka.uwagi} :`, 58.5, yS, { czc: f.i, roz: ROZMIAR.stopka, podkr: true });
  yS += 13;

  // Uwagi – gdy się nie mieszczą, ciąg dalszy na "Stronie 2" tego protokołu.
  const DOL_STRONY = 815;
  let numerStrony = 1;
  for (const linia of zawin(p.uwagi, f.r, 8.5, K.prawa + 25 - 58.5)) {
    if (yS > DOL_STRONY) {
      numerStrony++;
      strona = pdf.addPage(A4);
      t = rysownik(strona, f);
      naglowekStrony(t, f, numerStrony);
      t.tekst(`${sz.stopka.uwagi} (ciąg dalszy) – ${n.oznaczenie || n.typ || ''}`, 58.5, 45, { czc: f.i, roz: ROZMIAR.stopka, podkr: true });
      yS = 62;
    }
    t.tekst(linia, 58.5, yS, { roz: 8.5 });
    yS += 11;
  }
}

/**
 * Tworzy jeden plik PDF z wielu protokołów.
 * @param {Array<{protokol, obiekt, podpis?}>} lista – kolejność = kolejność w pliku; podpis = dataURL PNG autora
 * @returns {Promise<Uint8Array>}
 */
export async function utworzPdf(lista, tytul = 'Protokoły kontroli') {
  const bajty = await wczytajCzcionki();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const f = {};
  for (const k of Object.keys(bajty)) f[k] = await pdf.embedFont(bajty[k], { subset: true });
  // Podpisy (dataURL PNG) – każdy osadzony w pliku tylko raz.
  const obrazy = new Map();
  for (const { podpis } of lista) {
    if (podpis && !obrazy.has(podpis)) {
      try { obrazy.set(podpis, await pdf.embedPng(podpis)); } catch (e) { console.warn('Nie udało się wstawić podpisu', e); obrazy.set(podpis, null); }
    }
  }
  for (const { protokol, obiekt, podpis } of lista) rysujProtokol(pdf, f, protokol, obiekt, podpis ? obrazy.get(podpis) : null);
  pdf.setTitle(tytul);
  pdf.setCreator('Protokoły kontroli');
  pdf.setProducer('Protokoły kontroli');
  return pdf.save();
}

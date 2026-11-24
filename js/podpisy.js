// ============================================================
// podpisy.js – podpisy pracowników (do PDF protokołu).
//
// Każde konto ma jeden podpis: obrazek PNG z przezroczystym tłem,
// narysowany palcem w „Ustawienia → Mój podpis”.
// Firebase: podpisy/{kontoId} { id, konto, imie, obraz (dataURL PNG), zmieniono }.
// Czyta każdy członek zespołu (potrzebne do PDF), zapisuje tylko właściciel.
// Do PDF trafia podpis AUTORA protokołu – zawsze aktualny.
// ============================================================

import { baza } from './baza.js';
import { sesja } from './chmura.js';

const MAKS_ZNAKOW = 55000; // limit w regułach Firestore: 60000
const KOLOR = '#000000';   // czarny

// konto -> { obraz, imie, zmieniono } (tylko podpisy, które istnieją)
let podpisy = null;

// Wczytuje wszystkie podpisy (bez internetu – z pamięci telefonu).
export async function wczytajPodpisy(odswiez = false) {
  if (podpisy && !odswiez) return podpisy;
  const lista = await baza.wszystkie('podpisy');
  const nowe = new Map();
  for (const p of lista) if (p && p.konto && p.obraz) nowe.set(p.konto, p);
  podpisy = nowe;
  return podpisy;
}

export const podpisKonta = (konto) => (podpisy && podpisy.get(konto)) || null;
export const mamPodpis = () => !!(sesja && podpisKonta(sesja.konto));

// Zapis bez czekania na serwer (bez zasięgu wyśle się później).
export function zapiszMojPodpis(obraz) {
  const wpis = { id: sesja.konto, konto: sesja.konto, imie: sesja.imie, obraz, zmieniono: Date.now() };
  if (!podpisy) podpisy = new Map();
  podpisy.set(sesja.konto, wpis);
  return baza.zapisz('podpisy', wpis);
}

export const usunMojPodpis = () => usunPodpisKonta(sesja.konto);

// Usunięcie podpisu: własnego albo (administrator) dowolnej osoby.
export function usunPodpisKonta(konto) {
  if (podpisy) podpisy.delete(konto);
  return baza.usun('podpisy', konto);
}

// Podpis na czarno (starsze podpisy były granatowe). Przezroczystość zostaje.
const czarne = new Map();
export async function naCzarno(obraz) {
  if (czarne.has(obraz)) return czarne.get(obraz);
  const img = new Image();
  img.src = obraz;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const dane = cx.getImageData(0, 0, c.width, c.height);
  const px = dane.data;
  for (let i = 0; i < px.length; i += 4) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; }
  cx.putImageData(dane, 0, 0);
  const wynik = c.toDataURL('image/png');
  czarne.set(obraz, wynik);
  return wynik;
}

// ------------------------------------------------------------
// Pole do podpisu palcem.
// Kreski zapamiętane we współrzędnych 0..1 – po obrocie telefonu
// pole zmienia rozmiar, a podpis rysuje się od nowa (nie znika).
// ------------------------------------------------------------
export function polePodpisu(canvas) {
  const kreski = [];
  let biezaca = null;
  const ctx = canvas.getContext('2d');

  const grubosc = () => Math.max(2.5, canvas.width / 260);
  function dopasuj() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    rysuj();
  }
  function rysujKreske(k, c, szer, wys, gr) {
    c.strokeStyle = KOLOR; c.fillStyle = KOLOR;
    c.lineWidth = gr; c.lineCap = 'round'; c.lineJoin = 'round';
    const pkt = k.map(([x, y]) => [x * szer, y * wys]);
    if (pkt.length === 1) { c.beginPath(); c.arc(pkt[0][0], pkt[0][1], gr / 2, 0, Math.PI * 2); c.fill(); return; }
    // Wygładzanie: krzywe przez środki kolejnych odcinków.
    c.beginPath();
    c.moveTo(pkt[0][0], pkt[0][1]);
    for (let i = 1; i < pkt.length - 1; i++) {
      const sx = (pkt[i][0] + pkt[i + 1][0]) / 2, sy = (pkt[i][1] + pkt[i + 1][1]) / 2;
      c.quadraticCurveTo(pkt[i][0], pkt[i][1], sx, sy);
    }
    const ost = pkt[pkt.length - 1];
    c.lineTo(ost[0], ost[1]);
    c.stroke();
  }
  function rysuj() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const k of kreski) rysujKreske(k, ctx, canvas.width, canvas.height, grubosc());
  }
  const punkt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    biezaca = [punkt(e)];
    kreski.push(biezaca);
    rysuj();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!biezaca) return;
    e.preventDefault();
    const zdarzenia = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const z of (zdarzenia.length ? zdarzenia : [e])) biezaca.push(punkt(z));
    rysuj();
  });
  const koniec = () => { biezaca = null; };
  // iPhone/Safari: bez tego palec potrafi przesuwać stronę mimo touch-action.
  const stop = (e) => e.preventDefault();
  canvas.addEventListener('touchstart', stop, { passive: false });
  canvas.addEventListener('touchmove', stop, { passive: false });
  canvas.addEventListener('pointerup', koniec);
  canvas.addEventListener('pointercancel', koniec);
  window.addEventListener('resize', dopasuj);
  dopasuj();

  return {
    pusty: () => kreski.length === 0,
    wyczysc() { kreski.length = 0; rysuj(); },
    cofnij() { kreski.pop(); rysuj(); },
    zakoncz() { window.removeEventListener('resize', dopasuj); },
    // Obrazek PNG przycięty do samego podpisu (przezroczyste tło).
    obraz() {
      if (!kreski.length) return null;
      const r = canvas.getBoundingClientRect();
      // Rysujemy w stałej skali niezależnej od ekranu: szerokość pola = 900 px.
      const szer = 900, wys = Math.round(900 * r.height / r.width);
      const gr = 9;
      const xs = kreski.flat().map((p) => p[0] * szer), ys = kreski.flat().map((p) => p[1] * wys);
      const m = gr + 4;
      const x0 = Math.max(0, Math.min(...xs) - m), y0 = Math.max(0, Math.min(...ys) - m);
      const x1 = Math.min(szer, Math.max(...xs) + m), y1 = Math.min(wys, Math.max(...ys) + m);
      for (const maks of [700, 500, 350, 250]) {
        const skala = Math.min(1, maks / Math.max(x1 - x0, y1 - y0));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((x1 - x0) * skala));
        c.height = Math.max(1, Math.round((y1 - y0) * skala));
        const cx = c.getContext('2d');
        cx.scale(skala, skala);
        cx.translate(-x0, -y0);
        for (const k of kreski) rysujKreske(k, cx, szer, wys, gr);
        const url = c.toDataURL('image/png');
        if (url.length <= MAKS_ZNAKOW) return url;
      }
      return null;
    },
  };
}

// ------------------------------------------------------------
// Okno podpisu na cały ekran. Strona pod spodem jest zablokowana,
// więc podczas podpisywania nic się nie przesuwa.
// Zwraca obrazek PNG (dataURL) albo null, gdy anulowano.
// ------------------------------------------------------------
export function otworzOknoPodpisu() {
  return new Promise((gotowe) => {
    const okno = document.createElement('div');
    okno.className = 'podpis-okno';
    okno.innerHTML = `
      <div class="podpis-okno-gora">Podpisz się palcem w białym polu</div>
      <div class="podpis-okno-pole"><canvas></canvas><span class="podpis-linia"></span></div>
      <div class="podpis-okno-przyciski">
        <button class="sredni" data-p="anuluj">✕ Anuluj</button>
        <button class="sredni" data-p="cofnij">↶ Cofnij</button>
        <button class="sredni" data-p="wyczysc">🗑 Wyczyść</button>
        <button class="sredni glowny" data-p="gotowe">✓ Gotowe</button>
      </div>`;
    // Blokada przewijania strony pod oknem.
    const html = document.documentElement;
    const przewiniecie = window.scrollY;
    html.classList.add('podpis-blokada');
    document.body.style.top = `-${przewiniecie}px`;
    const blokuj = (e) => { if (!e.target.closest('.podpis-okno-przyciski')) e.preventDefault(); };
    okno.addEventListener('touchmove', blokuj, { passive: false });
    document.body.appendChild(okno);

    // Android: pełny ekran (bez pasków przeglądarki) i obrót poziomo – jeśli telefon pozwala.
    let pelny = false;
    (async () => {
      try {
        if (okno.requestFullscreen && !document.fullscreenElement) { await okno.requestFullscreen({ navigationUI: 'hide' }); pelny = true; }
        if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
      } catch (e) { /* iPhone i część przeglądarek – zostaje zwykłe okno */ }
    })();

    const pole = polePodpisu(okno.querySelector('canvas'));
    const zamknij = async (wynik) => {
      pole.zakoncz();
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* trudno */ }
      try { if (pelny && document.fullscreenElement) await document.exitFullscreen(); } catch (e) { /* trudno */ }
      okno.remove();
      html.classList.remove('podpis-blokada');
      document.body.style.top = '';
      window.scrollTo(0, przewiniecie);
      gotowe(wynik);
    };
    okno.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const co = b.dataset.p;
      if (co === 'anuluj') zamknij(null);
      else if (co === 'cofnij') pole.cofnij();
      else if (co === 'wyczysc') pole.wyczysc();
      else if (co === 'gotowe') {
        if (pole.pusty()) { alert('Najpierw podpisz się palcem w białym polu.'); return; }
        const obraz = pole.obraz();
        if (!obraz) { alert('Podpis jest zbyt skomplikowany – wyczyść i podpisz się jeszcze raz, prościej.'); return; }
        zamknij(obraz);
      }
    });
  });
}

// ------------------------------------------------------------
// Podpis ze zdjęcia (np. podpis na białej kartce).
// • zwykłe zdjęcie (JPG) – aplikacja sama usuwa tło: tło liczone osobno w każdej
//   części zdjęcia (cień, nierówne światło), ciemniejsze od tła = tusz;
// • PNG z przezroczystym tłem – używany bez zmian (tylko przycięcie i zmniejszenie).
// Wynik: czarny podpis, przezroczyste tło, przycięty.
// ------------------------------------------------------------
async function wczytajObraz(plik) {
  let zrodlo;
  try { zrodlo = await createImageBitmap(plik, { imageOrientation: 'from-image' }); } catch (e) {
    zrodlo = new Image();
    const adres = URL.createObjectURL(plik);
    zrodlo.src = adres;
    await zrodlo.decode();
    URL.revokeObjectURL(adres);
  }
  const w0 = zrodlo.width || zrodlo.naturalWidth, h0 = zrodlo.height || zrodlo.naturalHeight;
  const skala = Math.min(1, 1400 / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * skala)); c.height = Math.max(1, Math.round(h0 * skala));
  c.getContext('2d').drawImage(zrodlo, 0, 0, c.width, c.height);
  return c;
}

// Czy obraz ma już przezroczyste tło (gotowy PNG)?
function maPrzezroczystosc(dane) {
  let ile = 0;
  for (let i = 3; i < dane.data.length; i += 4) if (dane.data[i] < 200) ile++;
  return ile > dane.width * dane.height * 0.02;
}

// Mapa przezroczystości (0..1) dla zdjęcia; czulosc 0..1 (więcej = łapie jaśniejsze kreski).
function tuszZeZdjecia(canvas, czulosc) {
  const w = canvas.width, h = canvas.height;
  const dane = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  // Tło: zdjęcie mocno zmniejszone i powiększone z powrotem (średnia okolicy, kreski giną).
  const m = document.createElement('canvas');
  m.width = Math.max(2, Math.round(w / 24)); m.height = Math.max(2, Math.round(h / 24));
  m.getContext('2d').drawImage(canvas, 0, 0, m.width, m.height);
  const t = document.createElement('canvas');
  t.width = w; t.height = h;
  const tc = t.getContext('2d');
  tc.imageSmoothingEnabled = true;
  tc.drawImage(m, 0, 0, w, h);
  const tlo = tc.getImageData(0, 0, w, h).data;
  const prog = 0.34 - czulosc * 0.26; // 0,34 … 0,08
  const alfa = new Float32Array(w * h);
  for (let i = 0, j = 0; j < alfa.length; i += 4, j++) {
    const jas = 0.299 * dane[i] + 0.587 * dane[i + 1] + 0.114 * dane[i + 2];
    const jasT = Math.max(40, 0.299 * tlo[i] + 0.587 * tlo[i + 1] + 0.114 * tlo[i + 2]);
    const tusz = 1 - Math.min(1, jas / jasT);
    alfa[j] = Math.min(1, Math.max(0, (tusz - prog) / 0.12));
  }
  return alfa;
}

function alfaZPng(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const alfa = new Float32Array(canvas.width * canvas.height);
  for (let i = 3, j = 0; j < alfa.length; i += 4, j++) {
    // Białe/jasne piksele w PNG traktujemy jak tło (gdyby ktoś zostawił białe obramowanie).
    const jas = 0.299 * d[i - 3] + 0.587 * d[i - 2] + 0.114 * d[i - 1];
    alfa[j] = (d[i] / 255) * Math.min(1, Math.max(0, (245 - jas) / 60));
  }
  return alfa;
}

// Przycina do samego podpisu (pomija pojedyncze kropki) i zapisuje jako PNG.
function alfaDoPng(alfa, w, h) {
  const wiersze = new Uint32Array(h), kolumny = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alfa[y * w + x] > 0.5) { wiersze[y]++; kolumny[x]++; }
  const minW = Math.max(2, Math.round(w * 0.003)), minK = Math.max(2, Math.round(h * 0.003));
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  while (y0 < h && wiersze[y0] < minW) y0++;
  while (y1 > y0 && wiersze[y1] < minW) y1--;
  while (x0 < w && kolumny[x0] < minK) x0++;
  while (x1 > x0 && kolumny[x1] < minK) x1--;
  if (y0 >= h || x0 >= w) return null; // nic nie znaleziono
  const m = 6;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const pelny = document.createElement('canvas');
  pelny.width = sw; pelny.height = sh;
  const pc = pelny.getContext('2d');
  const obraz = pc.createImageData(sw, sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const a = alfa[(y + y0) * w + (x + x0)];
      obraz.data[(y * sw + x) * 4 + 3] = Math.round(a * 255); // kolor 0,0,0 = czarny
    }
  }
  pc.putImageData(obraz, 0, 0);
  for (const maks of [700, 500, 350, 250]) {
    const skala = Math.min(1, maks / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * skala)); c.height = Math.max(1, Math.round(sh * skala));
    c.getContext('2d').drawImage(pelny, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    if (url.length <= MAKS_ZNAKOW) return url;
  }
  return null;
}

// Okno z podglądem podpisu ze zdjęcia. Zwraca PNG (dataURL) albo null (anulowano).
export async function otworzOknoZdjeciaPodpisu(plik) {
  const canvas = await wczytajObraz(plik);
  const dane = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const png = maPrzezroczystosc(dane);
  return new Promise((gotowe) => {
    let czulosc = 0.6;
    let wynik = null;
    const okno = document.createElement('div');
    okno.className = 'podpis-okno podpis-okno-zdjecie';
    okno.innerHTML = `
      <div class="podpis-okno-gora">${png ? 'Podpis z pliku PNG (tło przezroczyste)' : 'Podpis ze zdjęcia – tło usunięte'}</div>
      <div class="podpis-okno-pole podpis-wynik"><img alt="Podgląd podpisu"><p class="pusto" hidden>Nie znaleziono podpisu – zwiększ czułość albo zrób wyraźniejsze zdjęcie.</p></div>
      ${png ? '' : `<label class="podpis-czulosc">Czułość: <span>jaśniej</span>
        <input type="range" min="0" max="100" value="60"><span>ciemniej</span></label>
        <p class="podpis-wskazowka">Zostały plamy lub cień? Przesuń w lewo. Podpis przerywany lub blady? Przesuń w prawo.</p>`}
      <div class="podpis-okno-przyciski dwa">
        <button class="sredni" data-p="anuluj">✕ Anuluj</button>
        <button class="sredni glowny" data-p="gotowe">✓ Gotowe</button>
      </div>`;
    const html = document.documentElement;
    const przewiniecie = window.scrollY;
    html.classList.add('podpis-blokada');
    document.body.style.top = `-${przewiniecie}px`;
    document.body.appendChild(okno);
    const img = okno.querySelector('img'), brak = okno.querySelector('.pusto');
    const przelicz = () => {
      const alfa = png ? alfaZPng(canvas) : tuszZeZdjecia(canvas, czulosc);
      wynik = alfaDoPng(alfa, canvas.width, canvas.height);
      img.hidden = !wynik; brak.hidden = !!wynik;
      if (wynik) img.src = wynik;
    };
    przelicz();
    let czekaj = null;
    const suwak = okno.querySelector('input[type=range]');
    if (suwak) suwak.addEventListener('input', () => {
      czulosc = suwak.value / 100;
      clearTimeout(czekaj);
      czekaj = setTimeout(przelicz, 120);
    });
    const zamknij = (w) => {
      okno.remove();
      html.classList.remove('podpis-blokada');
      document.body.style.top = '';
      window.scrollTo(0, przewiniecie);
      gotowe(w);
    };
    okno.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      if (b.dataset.p === 'anuluj') zamknij(null);
      else if (b.dataset.p === 'gotowe') {
        if (!wynik) { alert('Nie znaleziono podpisu na zdjęciu.'); return; }
        zamknij(wynik);
      }
    });
  });
}

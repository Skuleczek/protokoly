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

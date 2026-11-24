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
const KOLOR = '#14285a';   // ciemnogranatowy, jak długopis

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

export function usunMojPodpis() {
  if (podpisy) podpisy.delete(sesja.konto);
  return baza.usun('podpisy', sesja.konto);
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

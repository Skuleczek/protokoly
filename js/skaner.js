// ============================================================
// skaner.js – „skaner dokumentów” liczony w telefonie (bez internetu i kosztów):
//  - wykrywanie kartki (4 rogi) na zdjęciu,
//  - prostowanie perspektywy (kartka pod kątem -> prostokąt),
//  - filtry: oryginał, kontrast, szarość, dokument, czarno-biały,
//  - obrót o 90°.
// Rogi zapisujemy jako ułamki 0–1 szerokości/wysokości zdjęcia,
// w kolejności: lewy górny, prawy górny, prawy dolny, lewy dolny.
// ============================================================

export const FILTRY = [
  { id: 'oryginal', nazwa: 'Oryginał' },
  { id: 'kontrast', nazwa: 'Kontrast' },
  { id: 'szarosc', nazwa: 'Szarość' },
  { id: 'dokument', nazwa: 'Dokument' },
  { id: 'czarnobialy', nazwa: 'Czarno-biały' },
];
export const CALE_ZDJECIE = [[0, 0], [1, 0], [1, 1], [0, 1]];

// ------------------------------------------------------------
// Wczytanie zdjęcia (z uwzględnieniem obrotu zapisanego przez aparat)
// ------------------------------------------------------------
export async function wczytajObraz(plik) {
  const adres = URL.createObjectURL(plik);
  const img = new Image();
  img.src = adres;
  try { await img.decode(); } finally { URL.revokeObjectURL(adres); }
  return img;
}

function plotno(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

// Zdjęcie przeskalowane tak, by dłuższy bok miał najwyżej maxBok pikseli.
export function pomniejsz(img, maxBok) {
  const W = img.naturalWidth || img.width; const H = img.naturalHeight || img.height;
  const s = Math.min(1, maxBok / Math.max(W, H));
  const c = plotno(W * s, H * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ------------------------------------------------------------
// Wykrywanie kartki
// ------------------------------------------------------------
function rozmyj(dane, w, h, r) {
  // Rozmycie pudełkowe (dwa przejścia: poziome i pionowe).
  const tmp = new Float32Array(w * h); const wyn = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0; const o = y * w;
    for (let x = -r; x <= r; x++) s += dane[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / (2 * r + 1);
      s += dane[o + Math.min(w - 1, x + r + 1)] - dane[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      wyn[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return wyn;
}

function progOtsu(wartosci) {
  const hist = new Array(256).fill(0);
  for (const v of wartosci) hist[Math.max(0, Math.min(255, v | 0))]++;
  const n = wartosci.length; let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sB = 0; let wB = 0; let najl = 0; let prog = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB; const mF = (suma - sB) / wF;
    const miedzy = wB * wF * (mB - mF) * (mB - mF);
    if (miedzy > najl) { najl = miedzy; prog = t; }
  }
  return prog;
}

function morfologia(maska, w, h, rozszerz) {
  // Jedno przejście erozji (rozszerz=false) albo dylatacji (true) w sąsiedztwie 3x3.
  const wyn = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = rozszerz ? 0 : 1;
      for (let dy = -1; dy <= 1 && (rozszerz ? !v : v); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; const yy = y + dy;
          const m = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : maska[yy * w + xx];
          if (rozszerz && m) { v = 1; break; }
          if (!rozszerz && !m) { v = 0; break; }
        }
      }
      wyn[y * w + x] = v;
    }
  }
  return wyn;
}

/**
 * Szuka kartki (jasny, mało kolorowy obszar). Zwraca 4 rogi (ułamki 0–1)
 * albo null, gdy nie znaleziono nic sensownego.
 */
export function wykryjKartke(img) {
  const c = pomniejsz(img, 360);
  const w = c.width; const h = c.height;
  const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  // Ocena „bieli”: jasność minus nasycenie koloru (biurko bywa jasne, ale kolorowe).
  const ocena = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4]; const g = px[i * 4 + 1]; const b = px[i * 4 + 2];
    const jasnosc = 0.299 * r + 0.587 * g + 0.114 * b;
    const nasycenie = Math.max(r, g, b) - Math.min(r, g, b);
    ocena[i] = jasnosc - 1.2 * nasycenie;
  }
  const gladka = rozmyj(ocena, w, h, 2);
  const prog = progOtsu(gladka);
  let maska = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) maska[i] = gladka[i] > prog ? 1 : 0;
  maska = morfologia(morfologia(maska, w, h, false), w, h, false);
  maska = morfologia(morfologia(maska, w, h, true), w, h, true);

  // Największy spójny obszar.
  const etyk = new Int32Array(w * h); let najw = 0; let najwEt = 0; let et = 0;
  const stos = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!maska[s] || etyk[s]) continue;
    et++; let n = 0; let wierzch = 0; stos[wierzch++] = s; etyk[s] = et;
    while (wierzch) {
      const p = stos[--wierzch]; n++;
      const x = p % w; const y = (p / w) | 0;
      if (x > 0 && maska[p - 1] && !etyk[p - 1]) { etyk[p - 1] = et; stos[wierzch++] = p - 1; }
      if (x < w - 1 && maska[p + 1] && !etyk[p + 1]) { etyk[p + 1] = et; stos[wierzch++] = p + 1; }
      if (y > 0 && maska[p - w] && !etyk[p - w]) { etyk[p - w] = et; stos[wierzch++] = p - w; }
      if (y < h - 1 && maska[p + w] && !etyk[p + w]) { etyk[p + w] = et; stos[wierzch++] = p + w; }
    }
    if (n > najw) { najw = n; najwEt = et; }
  }
  if (najw < 0.12 * w * h || najw > 0.985 * w * h) return null;

  // Rogi: skrajne punkty wzdłuż przekątnych.
  let lg = [0, 0, Infinity]; let pg = [0, 0, -Infinity]; let pd = [0, 0, -Infinity]; let ld = [0, 0, Infinity];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (etyk[y * w + x] !== najwEt) continue;
      const s = x + y; const r = x - y;
      if (s < lg[2]) lg = [x, y, s];
      if (s > pd[2]) pd = [x, y, s];
      if (r > pg[2]) pg = [x, y, r];
      if (r < ld[2]) ld = [x, y, r];
    }
  }
  const rogi = [lg, pg, pd, ld].map(([x, y]) => [Math.min(1, Math.max(0, (x + 0.5) / w)), Math.min(1, Math.max(0, (y + 0.5) / h))]);
  // Odrzuć zdegenerowane czworokąty (za małe pole).
  const pole = Math.abs(rogi.reduce((s, [x, y], i) => { const [x2, y2] = rogi[(i + 1) % 4]; return s + x * y2 - x2 * y; }, 0)) / 2;
  if (pole < 0.1) return null;
  return rogi;
}

// ------------------------------------------------------------
// Prostowanie perspektywy (homografia)
// ------------------------------------------------------------
function rozwiaz(A, b) {
  // Eliminacja Gaussa z wyborem elementu głównego (układ 8x8).
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

// Macierz przekształcająca punkt (u,v) wyniku na punkt (x,y) zdjęcia.
function homografia(cel, zrodlo) {
  const A = []; const b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = cel[i]; const [x, y] = zrodlo[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  return rozwiaz(A, b);
}

const odl = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Wycina i prostuje kartkę. Zwraca canvas o dłuższym boku <= maxBok.
 */
export function wyprostuj(img, rogi, maxBok) {
  const W = img.naturalWidth || img.width; const H = img.naturalHeight || img.height;
  const pelne = !rogi || rogi.every(([x, y], i) => Math.abs(x - CALE_ZDJECIE[i][0]) < 1e-6 && Math.abs(y - CALE_ZDJECIE[i][1]) < 1e-6);
  if (pelne) return pomniejsz(img, maxBok);
  // Źródło w rozdzielczości wystarczającej do wyniku (oszczędza pamięć telefonu).
  const zrodloC = pomniejsz(img, Math.min(Math.max(W, H), Math.round(maxBok * 1.3)));
  const sw = zrodloC.width; const sh = zrodloC.height;
  const zr = rogi.map(([x, y]) => [x * sw, y * sh]);
  let ow = Math.max(odl(zr[0], zr[1]), odl(zr[3], zr[2]));
  let oh = Math.max(odl(zr[0], zr[3]), odl(zr[1], zr[2]));
  const s = Math.min(1, maxBok / Math.max(ow, oh));
  ow = Math.max(1, Math.round(ow * s)); oh = Math.max(1, Math.round(oh * s));
  const Hm = homografia([[0, 0], [ow, 0], [ow, oh], [0, oh]], zr);
  const zd = zrodloC.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  zrodloC.width = 0;
  const wyn = plotno(ow, oh);
  const ctx = wyn.getContext('2d');
  const obraz = ctx.createImageData(ow, oh); const d = obraz.data;
  for (let v = 0; v < oh; v++) {
    for (let u = 0; u < ow; u++) {
      const mian = Hm[6] * u + Hm[7] * v + 1;
      let x = (Hm[0] * u + Hm[1] * v + Hm[2]) / mian;
      let y = (Hm[3] * u + Hm[4] * v + Hm[5]) / mian;
      x = Math.min(sw - 1.001, Math.max(0, x)); y = Math.min(sh - 1.001, Math.max(0, y));
      const x0 = x | 0; const y0 = y | 0; const fx = x - x0; const fy = y - y0;
      const i00 = (y0 * sw + x0) * 4; const i10 = i00 + 4; const i01 = i00 + sw * 4; const i11 = i01 + 4;
      const o = (v * ow + u) * 4;
      for (let k = 0; k < 3; k++) {
        d[o + k] = (zd[i00 + k] * (1 - fx) + zd[i10 + k] * fx) * (1 - fy) + (zd[i01 + k] * (1 - fx) + zd[i11 + k] * fx) * fy;
      }
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(obraz, 0, 0);
  return wyn;
}

// ------------------------------------------------------------
// Filtry
// ------------------------------------------------------------
function srednieLokalne(jas, w, h, r) {
  // Średnia w kwadracie (2r+1) liczona z obrazu całkowego.
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let wiersz = 0;
    for (let x = 0; x < w; x++) { wiersz += jas[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + wiersz; }
  }
  const wyn = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r); const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r); const x1 = Math.min(w, x + r + 1);
      const suma = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
      wyn[y * w + x] = suma / ((x1 - x0) * (y1 - y0));
    }
  }
  return wyn;
}

export function zastosujFiltr(c, filtr) {
  if (!filtr || filtr === 'oryginal') return c;
  const w = c.width; const h = c.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const obraz = ctx.getImageData(0, 0, w, h); const d = obraz.data;
  const n = w * h;
  if (filtr === 'kontrast') {
    // Rozciągnięcie zakresu każdego koloru (1%–99%).
    for (let k = 0; k < 3; k++) {
      const hist = new Uint32Array(256);
      for (let i = 0; i < n; i++) hist[d[i * 4 + k]]++;
      let lo = 0; let hi = 255; let acc = 0;
      while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
      acc = 0; while (hi > 0 && (acc += hist[hi]) < n * 0.01) hi--;
      const zakres = Math.max(1, hi - lo);
      for (let i = 0; i < n; i++) d[i * 4 + k] = Math.min(255, Math.max(0, ((d[i * 4 + k] - lo) * 255) / zakres));
    }
  } else {
    const jas = new Float32Array(n);
    for (let i = 0; i < n; i++) jas[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let wyn = jas;
    if (filtr === 'dokument') {
      // Wyrównanie tła (cienie, nierówne światło) -> białe tło, zachowane odcienie tekstu.
      const tlo = srednieLokalne(jas, w, h, Math.max(8, Math.round(Math.max(w, h) / 20)));
      wyn = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const v = jas[i] / Math.max(1, tlo[i]); // 1 = tło, mniej = tekst/kreski
        // Tło -> białe, tekst -> wyraźnie ciemniejszy (rozciągnięcie zakresu 0,55–0,93).
        const t = Math.min(1, Math.max(0, (v - 0.55) / 0.38));
        wyn[i] = 255 * Math.pow(t, 1.6);
      }
    } else if (filtr === 'czarnobialy') {
      // Próg lokalny – jak w skanerze.
      const sr = srednieLokalne(jas, w, h, Math.max(6, Math.round(Math.max(w, h) / 32)));
      wyn = new Float32Array(n);
      for (let i = 0; i < n; i++) wyn[i] = jas[i] < sr[i] * 0.86 ? 0 : 255;
    }
    for (let i = 0; i < n; i++) { const v = Math.min(255, Math.max(0, wyn[i])); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; }
  }
  ctx.putImageData(obraz, 0, 0);
  return c;
}

export function obroc(c, stopnie) {
  const st = ((stopnie % 360) + 360) % 360;
  if (!st) return c;
  const pion = st === 90 || st === 270;
  const wyn = plotno(pion ? c.height : c.width, pion ? c.width : c.height);
  const ctx = wyn.getContext('2d');
  ctx.translate(wyn.width / 2, wyn.height / 2);
  ctx.rotate((st * Math.PI) / 180);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  c.width = 0;
  return wyn;
}

/**
 * Pełne przetworzenie zdjęcia: przycięcie/wyprostowanie -> filtr -> obrót.
 * @param z { rogi, filtr, obrot }
 * @returns canvas
 */
export function przetworz(img, z, maxBok) {
  let c = wyprostuj(img, z.rogi, maxBok);
  c = zastosujFiltr(c, z.filtr);
  return obroc(c, z.obrot || 0);
}

export const doJpeg = (c, jakosc = 0.85) => new Promise((ok) => c.toBlob(ok, 'image/jpeg', jakosc));

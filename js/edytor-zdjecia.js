// ============================================================
// edytor-zdjecia.js – ekran edycji zdjęć w „Zdjęcia → PDF”:
// przesuwanie 4 rogów kartki (z lupą), automatyczne wykrywanie,
// całe zdjęcie, obrót, filtr (osobno lub dla wszystkich) i podgląd.
// Strzałkami przechodzi się po kolei przez wszystkie zdjęcia.
// ============================================================

import * as S from './skaner.js';

const kopia = (z) => ({ rogi: (z.rogi || S.CALE_ZDJECIE).map((r) => [...r]), filtr: z.filtr || 'oryginal', obrot: z.obrot || 0 });
const takieSame = (a, b) => JSON.stringify(kopia(a)) === JSON.stringify(kopia(b));

/**
 * Otwiera edytor na zdjęciu nr `start` (od 0).
 * Po „Gotowe” zapisuje rogi/filtr/obrót w zdjęciach.
 * @returns {Promise<{zmienione: number[], filtrDlaWszystkich: string|null}|null>} null = anulowano
 */
export async function edytujZdjecia(lista, start = 0) {
  if (!lista.length) return null;
  const stany = lista.map(() => null); // zmiany w trakcie edycji (null = bez zmian)
  const stanZdjecia = (i) => (stany[i] = stany[i] || kopia(lista[i]));
  let filtrDlaWszystkich = null;
  let nr = Math.min(Math.max(0, start), lista.length - 1);
  let img = null; // bieżące zdjęcie (pełne)
  let mal = null; // pomniejszone do wyświetlania
  let stan = null; // stan bieżącego zdjęcia
  let podgladWlaczony = false;
  let wczytywanie = 0; // licznik – chroni przed szybkim klikaniem strzałek

  const okno = document.createElement('div');
  okno.className = 'edytor';
  okno.innerHTML = `
    <div class="e-gora">
      <button data-e="anuluj">Anuluj</button>
      <span class="e-licznik"></span>
      <button data-e="gotowe" class="e-gotowe">✓ Gotowe</button>
    </div>
    <div class="e-obszar">
      <canvas class="e-obraz"></canvas>
      <svg class="e-ramka"><polygon></polygon></svg>
      ${[0, 1, 2, 3].map((i) => `<div class="e-uchwyt" data-i="${i}"></div>`).join('')}
      <canvas class="e-lupa" width="140" height="140"></canvas>
      <canvas class="e-podglad"></canvas>
      <div class="e-laduje">Wczytuję zdjęcie…</div>
    </div>
    <div class="e-dol">
      <div class="e-narzedzia">
        <button data-e="wykryj">🪄 Wykryj</button>
        <button data-e="cale">⬜ Całe</button>
        <button data-e="obroc">⟳ Obróć</button>
        <button data-e="podglad">👁 Podgląd</button>
      </div>
      <div class="e-filtry">${S.FILTRY.map((f) => `<button data-filtr="${f.id}">${f.nazwa}</button>`).join('')}</div>
      ${lista.length > 1 ? '<button class="e-wszystkie" data-e="wszystkie">Zastosuj filtr dla wszystkich zdjęć</button>' : ''}
      <div class="e-info"></div>
      ${lista.length > 1 ? `<div class="e-nawigacja">
        <button data-e="poprzednie">◀ Poprzednie</button>
        <button data-e="nastepne">Następne ▶</button>
      </div>` : ''}
    </div>`;
  document.body.appendChild(okno);

  const obszar = okno.querySelector('.e-obszar');
  const plotno = okno.querySelector('.e-obraz');
  const ramka = okno.querySelector('.e-ramka');
  const uchwyty = [...okno.querySelectorAll('.e-uchwyt')];
  const lupa = okno.querySelector('.e-lupa');
  const podglad = okno.querySelector('.e-podglad');
  const info = okno.querySelector('.e-info');
  const laduje = okno.querySelector('.e-laduje');

  function rozmiesc() {
    if (!img) return;
    const W = obszar.clientWidth - 24; const H = obszar.clientHeight - 24;
    const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
    const s = Math.min(W / iw, H / ih);
    const dw = Math.round(iw * s); const dh = Math.round(ih * s);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!mal) mal = S.pomniejsz(img, 1600);
    plotno.width = dw * dpr; plotno.height = dh * dpr;
    plotno.style.width = `${dw}px`; plotno.style.height = `${dh}px`;
    plotno.style.left = `${(obszar.clientWidth - dw) / 2}px`; plotno.style.top = `${(obszar.clientHeight - dh) / 2}px`;
    plotno.getContext('2d').drawImage(mal, 0, 0, plotno.width, plotno.height);
    ramka.setAttribute('width', obszar.clientWidth); ramka.setAttribute('height', obszar.clientHeight);
    rysujRamke();
    if (podgladWlaczony) pokazPodglad();
  }

  const pozycja = ([x, y]) => [plotno.offsetLeft + x * plotno.offsetWidth, plotno.offsetTop + y * plotno.offsetHeight];

  function rysujRamke() {
    if (!stan) return;
    const p = stan.rogi.map(pozycja);
    ramka.querySelector('polygon').setAttribute('points', p.map((q) => q.join(',')).join(' '));
    uchwyty.forEach((u, i) => { u.style.left = `${p[i][0]}px`; u.style.top = `${p[i][1]}px`; });
    const nazwaFiltra = S.FILTRY.find((f) => f.id === stan.filtr).nazwa;
    info.textContent = `Filtr: ${nazwaFiltra}${stan.obrot ? ` · obrót ${stan.obrot}°` : ''}${podgladWlaczony ? '' : ' · przeciągnij rogi na rogi kartki'}`;
    okno.querySelectorAll('[data-filtr]').forEach((b) => b.classList.toggle('wybrany', b.dataset.filtr === stan.filtr));
  }

  function pokazPodglad() {
    if (!img) return;
    const c = S.przetworz(img, stan, 1400);
    const W = obszar.clientWidth - 24; const H = obszar.clientHeight - 24;
    const s = Math.min(W / c.width, H / c.height, 1.5);
    podglad.width = c.width; podglad.height = c.height;
    podglad.getContext('2d').drawImage(c, 0, 0);
    c.width = 0; // zwolnij pamięć
    const w = podglad.width * s; const h = podglad.height * s;
    podglad.style.width = `${w}px`; podglad.style.height = `${h}px`;
    podglad.style.left = `${(obszar.clientWidth - w) / 2}px`; podglad.style.top = `${(obszar.clientHeight - h) / 2}px`;
  }

  function ustawTryb() {
    okno.classList.toggle('tryb-podglad', podgladWlaczony);
    okno.querySelector('[data-e=podglad]').textContent = podgladWlaczony ? '✏ Rogi' : '👁 Podgląd';
    if (podgladWlaczony) pokazPodglad();
    rysujRamke();
  }

  function odswiezNawigacje() {
    okno.querySelector('.e-licznik').textContent = `Zdjęcie ${nr + 1} z ${lista.length}`;
    const pop = okno.querySelector('[data-e=poprzednie]'); const nast = okno.querySelector('[data-e=nastepne]');
    if (pop) pop.disabled = nr === 0;
    if (nast) nast.disabled = nr === lista.length - 1;
  }

  // Wczytuje zdjęcie nr i (stan poprzedniego zostaje w `stany`).
  async function pokazZdjecie(i) {
    nr = i;
    const moj = ++wczytywanie;
    stan = stanZdjecia(i);
    odswiezNawigacje();
    okno.classList.add('wczytuje');
    laduje.textContent = 'Wczytuję zdjęcie…';
    let nowy;
    try { nowy = await S.wczytajObraz(lista[i].plik); } catch (e) {
      if (moj !== wczytywanie) return;
      img = null; mal = null;
      laduje.textContent = '⚠ Nie udało się odczytać tego zdjęcia.';
      return;
    }
    if (moj !== wczytywanie) return; // w międzyczasie przełączono na inne zdjęcie
    img = nowy; mal = null;
    okno.classList.remove('wczytuje');
    rozmiesc();
    ustawTryb();
  }

  // --- przeciąganie rogów (z lupą)
  let aktywny = -1;
  function rysujLupe(x, y) {
    const ctx = lupa.getContext('2d');
    const zoom = 3; const r = 70;
    const sx = x * mal.width; const sy = y * mal.height;
    const zakres = (r / zoom) * (mal.width / plotno.offsetWidth);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 140, 140);
    ctx.drawImage(mal, sx - zakres, sy - zakres, zakres * 2, zakres * 2, 0, 0, 140, 140);
    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(70, 50); ctx.lineTo(70, 90); ctx.moveTo(50, 70); ctx.lineTo(90, 70); ctx.stroke();
  }
  uchwyty.forEach((u) => {
    u.addEventListener('pointerdown', (e) => {
      if (!mal) return;
      e.preventDefault(); aktywny = +u.dataset.i; u.setPointerCapture(e.pointerId); u.classList.add('przeciagany');
      lupa.style.display = 'block';
      rysujLupe(...stan.rogi[aktywny]);
    });
    u.addEventListener('pointermove', (e) => {
      if (aktywny < 0) return;
      const r = plotno.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      stan.rogi[aktywny] = [x, y];
      // Lupa po przeciwnej stronie niż palec.
      lupa.style.left = x < 0.5 ? '' : '12px'; lupa.style.right = x < 0.5 ? '12px' : '';
      rysujLupe(x, y); rysujRamke();
    });
    const koniec = () => { aktywny = -1; u.classList.remove('przeciagany'); lupa.style.display = 'none'; };
    u.addEventListener('pointerup', koniec); u.addEventListener('pointercancel', koniec);
  });

  // --- przyciski
  return new Promise((ok) => {
    const zamknij = (zapisz) => {
      window.removeEventListener('resize', rozmiesc);
      okno.remove();
      if (!zapisz) { ok(null); return; }
      const zmienione = [];
      stany.forEach((s, i) => {
        if (!s || takieSame(s, lista[i])) return;
        Object.assign(lista[i], s);
        zmienione.push(i);
      });
      ok({ zmienione, filtrDlaWszystkich });
    };
    okno.addEventListener('click', (e) => {
      const b = e.target.closest('[data-e],[data-filtr]');
      if (!b || b.disabled) return;
      if (b.dataset.filtr) { stan.filtr = b.dataset.filtr; if (podgladWlaczony) pokazPodglad(); rysujRamke(); return; }
      const co = b.dataset.e;
      if (co === 'anuluj') {
        const sa = stany.some((s, i) => s && !takieSame(s, lista[i]));
        if (!sa || confirm('Odrzucić zmiany wprowadzone w zdjęciach?')) zamknij(false);
      } else if (co === 'gotowe') zamknij(true);
      else if (co === 'poprzednie' && nr > 0) pokazZdjecie(nr - 1);
      else if (co === 'nastepne' && nr < lista.length - 1) pokazZdjecie(nr + 1);
      else if (co === 'wszystkie') {
        lista.forEach((_, i) => { stanZdjecia(i).filtr = stan.filtr; });
        filtrDlaWszystkich = stan.filtr;
        const nazwa = S.FILTRY.find((f) => f.id === stan.filtr).nazwa;
        rysujRamke();
        info.textContent = `✓ Filtr „${nazwa}” ustawiony dla wszystkich ${lista.length} zdjęć`;
      } else if (!img) {
        // zdjęcie się jeszcze wczytuje albo jest uszkodzone – narzędzia nieaktywne
      } else if (co === 'wykryj') {
        const r = S.wykryjKartke(img);
        if (r) stan.rogi = r;
        if (podgladWlaczony) pokazPodglad(); rysujRamke();
        info.textContent = r ? '🪄 Wykryto kartkę' : 'Nie udało się wykryć kartki – ustaw rogi ręcznie.';
      } else if (co === 'cale') { stan.rogi = S.CALE_ZDJECIE.map((r) => [...r]); if (podgladWlaczony) pokazPodglad(); rysujRamke(); }
      else if (co === 'obroc') { stan.obrot = (stan.obrot + 90) % 360; podgladWlaczony = true; ustawTryb(); }
      else if (co === 'podglad') { podgladWlaczony = !podgladWlaczony; ustawTryb(); }
    });
    window.addEventListener('resize', rozmiesc);
    requestAnimationFrame(() => pokazZdjecie(nr));
  });
}

// ============================================================
// edytor-zdjecia.js – ekran edycji jednego zdjęcia w „Zdjęcia → PDF”:
// przesuwanie 4 rogów kartki (z lupą), automatyczne wykrywanie,
// całe zdjęcie, obrót, filtr i podgląd wyniku.
// ============================================================

import * as S from './skaner.js';

/**
 * Otwiera edytor. Zmienia z.rogi / z.filtr / z.obrot po „Gotowe”.
 * @returns {Promise<boolean>} true = zapisano zmiany
 */
export async function edytujZdjecie(z, numer, razem) {
  const img = await S.wczytajObraz(z.plik);
  const stan = { rogi: (z.rogi || S.CALE_ZDJECIE).map((r) => [...r]), filtr: z.filtr || 'oryginal', obrot: z.obrot || 0, podglad: false };

  const okno = document.createElement('div');
  okno.className = 'edytor';
  okno.innerHTML = `
    <div class="e-gora">
      <button data-e="anuluj">Anuluj</button>
      <span>Zdjęcie ${numer} / ${razem}</span>
      <button data-e="gotowe" class="e-gotowe">✓ Gotowe</button>
    </div>
    <div class="e-obszar">
      <canvas class="e-obraz"></canvas>
      <svg class="e-ramka"><polygon></polygon></svg>
      ${[0, 1, 2, 3].map((i) => `<div class="e-uchwyt" data-i="${i}"></div>`).join('')}
      <canvas class="e-lupa" width="140" height="140"></canvas>
      <canvas class="e-podglad"></canvas>
    </div>
    <div class="e-dol">
      <div class="e-narzedzia">
        <button data-e="wykryj">🪄 Wykryj</button>
        <button data-e="cale">⬜ Całe</button>
        <button data-e="obroc">⟳ Obróć</button>
        <button data-e="podglad">👁 Podgląd</button>
      </div>
      <div class="e-filtry">${S.FILTRY.map((f) => `<button data-filtr="${f.id}">${f.nazwa}</button>`).join('')}</div>
      <div class="e-info"></div>
    </div>`;
  document.body.appendChild(okno);

  const obszar = okno.querySelector('.e-obszar');
  const plotno = okno.querySelector('.e-obraz');
  const ramka = okno.querySelector('.e-ramka');
  const uchwyty = [...okno.querySelectorAll('.e-uchwyt')];
  const lupa = okno.querySelector('.e-lupa');
  const podglad = okno.querySelector('.e-podglad');
  const info = okno.querySelector('.e-info');
  let mal = null; // pomniejszone zdjęcie do wyświetlania

  function rozmiesc() {
    const W = obszar.clientWidth - 24; const H = obszar.clientHeight - 24;
    const iw = img.naturalWidth; const ih = img.naturalHeight;
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
  }

  const pozycja = ([x, y]) => [plotno.offsetLeft + x * plotno.offsetWidth, plotno.offsetTop + y * plotno.offsetHeight];

  function rysujRamke() {
    const p = stan.rogi.map(pozycja);
    ramka.querySelector('polygon').setAttribute('points', p.map((q) => q.join(',')).join(' '));
    uchwyty.forEach((u, i) => { u.style.left = `${p[i][0]}px`; u.style.top = `${p[i][1]}px`; });
    const nazwaFiltra = S.FILTRY.find((f) => f.id === stan.filtr).nazwa;
    info.textContent = `Filtr: ${nazwaFiltra}${stan.obrot ? ` · obrót ${stan.obrot}°` : ''} · przeciągnij rogi na rogi kartki`;
    okno.querySelectorAll('[data-filtr]').forEach((b) => b.classList.toggle('wybrany', b.dataset.filtr === stan.filtr));
  }

  function pokazPodglad() {
    const c = S.przetworz(img, stan, 1400);
    const W = obszar.clientWidth - 24; const H = obszar.clientHeight - 24;
    const s = Math.min(W / c.width, H / c.height, 1.5);
    podglad.width = c.width; podglad.height = c.height;
    podglad.getContext('2d').drawImage(c, 0, 0);
    podglad.style.width = `${c.width * s}px`; podglad.style.height = `${c.height * s}px`;
    podglad.style.left = `${(obszar.clientWidth - c.width * s) / 2}px`; podglad.style.top = `${(obszar.clientHeight - c.height * s) / 2}px`;
  }

  function ustawTryb() {
    okno.classList.toggle('tryb-podglad', stan.podglad);
    okno.querySelector('[data-e=podglad]').textContent = stan.podglad ? '✏ Rogi' : '👁 Podgląd';
    if (stan.podglad) pokazPodglad();
    rysujRamke();
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
      if (zapisz) { z.rogi = stan.rogi; z.filtr = stan.filtr; z.obrot = stan.obrot; }
      ok(zapisz);
    };
    okno.addEventListener('click', (e) => {
      const b = e.target.closest('[data-e],[data-filtr]');
      if (!b) return;
      if (b.dataset.filtr) { stan.filtr = b.dataset.filtr; if (stan.podglad) pokazPodglad(); rysujRamke(); return; }
      const co = b.dataset.e;
      if (co === 'anuluj') zamknij(false);
      else if (co === 'gotowe') zamknij(true);
      else if (co === 'wykryj') {
        const r = S.wykryjKartke(img);
        if (r) stan.rogi = r;
        if (stan.podglad) pokazPodglad(); rysujRamke();
        info.textContent = r ? '🪄 Wykryto kartkę' : 'Nie udało się wykryć kartki – ustaw rogi ręcznie.';
      } else if (co === 'cale') { stan.rogi = S.CALE_ZDJECIE.map((r) => [...r]); if (stan.podglad) pokazPodglad(); rysujRamke(); }
      else if (co === 'obroc') { stan.obrot = (stan.obrot + 90) % 360; stan.podglad = true; ustawTryb(); }
      else if (co === 'podglad') { stan.podglad = !stan.podglad; ustawTryb(); }
    });
    window.addEventListener('resize', rozmiesc);
    requestAnimationFrame(() => { rozmiesc(); ustawTryb(); });
  });
}

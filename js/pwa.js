// ============================================================
// pwa.js – instalacja aplikacji na ekranie głównym i aktualizacje.
// ============================================================

let zdarzenieInstalacji = null; // Android/Chrome: systemowe okienko „Zainstaluj”
let oczekujacaWersja = null;    // nowa wersja czekająca na „Odśwież”
const sluchacze = { aktualizacja: [], instalacja: [] };
const powiadom = (typ) => sluchacze[typ].forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
export const przyNowejWersji = (fn) => sluchacze.aktualizacja.push(fn);
export const przyMozliwejInstalacji = (fn) => sluchacze.instalacja.push(fn);

// Czy aplikacja jest uruchomiona z ikony (zainstalowana)?
export const zainstalowana = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const toIPhone = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const toAndroid = () => /Android/i.test(navigator.userAgent);
export const moznaZainstalowac = () => !!zdarzenieInstalacji;
export const jestNowaWersja = () => !!oczekujacaWersja;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // pokażemy własny przycisk „Zainstaluj”
  zdarzenieInstalacji = e;
  powiadom('instalacja');
});
window.addEventListener('appinstalled', () => { zdarzenieInstalacji = null; powiadom('instalacja'); });

export async function zainstaluj() {
  if (!zdarzenieInstalacji) return false;
  zdarzenieInstalacji.prompt();
  const { outcome } = await zdarzenieInstalacji.userChoice;
  zdarzenieInstalacji = null;
  powiadom('instalacja');
  return outcome === 'accepted';
}

let rejestracja = null;
function obserwuj(reg) {
  const sprawdzOczekujaca = () => {
    if (reg.waiting && navigator.serviceWorker.controller) { oczekujacaWersja = reg.waiting; powiadom('aktualizacja'); }
  };
  sprawdzOczekujaca();
  reg.addEventListener('updatefound', () => {
    const nowy = reg.installing;
    if (!nowy) return;
    nowy.addEventListener('statechange', () => { if (nowy.state === 'installed') sprawdzOczekujaca(); });
  });
}

export async function uruchom() {
  if (!('serviceWorker' in navigator)) return;
  try {
    rejestracja = await navigator.serviceWorker.register('sw.js');
    obserwuj(rejestracja);
    // Po „Odśwież” nowa wersja przejmuje stronę – przeładowujemy raz.
    let przeladowano = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (przeladowano) return;
      przeladowano = true;
      window.location.reload();
    });
    // Sprawdzaj aktualizacje przy powrocie do aplikacji i co 30 minut.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sprawdzAktualizacje(); });
    setInterval(sprawdzAktualizacje, 30 * 60 * 1000);
  } catch (e) {
    console.error('Service worker:', e);
  }
}

export async function sprawdzAktualizacje() {
  if (!rejestracja || !navigator.onLine) return false;
  try { await rejestracja.update(); } catch (e) { return false; }
  // Jeśli nowa wersja właśnie się pobiera – poczekaj (maks. 30 s), aż będzie gotowa.
  const nowy = rejestracja.installing;
  if (nowy) {
    await new Promise((ok) => {
      const koniec = setTimeout(ok, 30000);
      nowy.addEventListener('statechange', () => {
        if (nowy.state === 'installed' || nowy.state === 'redundant') { clearTimeout(koniec); setTimeout(ok, 50); }
      });
    });
  }
  return jestNowaWersja();
}

// „Odśwież” – nowa wersja przejmuje stronę (potem automatyczne przeładowanie).
export function zastosujNowaWersje() {
  if (oczekujacaWersja) oczekujacaWersja.postMessage('aktywuj');
  else window.location.reload();
}

// ============================================================
// sw.js – service worker: zapisuje pliki aplikacji w telefonie,
// żeby aplikacja uruchamiała się BEZ INTERNETU, i obsługuje aktualizacje.
//
// WERSJA i lista PLIKI są uzupełniane automatycznie przez
// narzedzia/publikuj.sh – nie zmieniaj ich ręcznie.
// Dane (protokoły) NIE są tu zapisywane – tym zajmuje się Firebase.
// ============================================================

const WERSJA = '2026.11.24-1814'; // @wersja
const PLIKI = [ // @pliki-start
  './',
  './css/czcionki/barlow-condensed-latin-700-normal.woff2',
  './css/czcionki/barlow-condensed-latin-ext-700-normal.woff2',
  './css/czcionki/barlow-latin-500-normal.woff2',
  './css/czcionki/barlow-latin-600-normal.woff2',
  './css/czcionki/barlow-latin-700-normal.woff2',
  './css/czcionki/barlow-latin-ext-500-normal.woff2',
  './css/czcionki/barlow-latin-ext-600-normal.woff2',
  './css/czcionki/barlow-latin-ext-700-normal.woff2',
  './css/styl.css',
  './dane/slownik-startowy.json',
  './dane/szablon.json',
  './dane/zmiany.json',
  './ikony/apple-touch-icon.png',
  './ikony/favicon-32.png',
  './ikony/ikona-192.png',
  './ikony/ikona-512.png',
  './ikony/ikona-maskable-512.png',
  './index.html',
  './js/ai.js',
  './js/aplikacja.js',
  './js/baza.js',
  './js/chmura.js',
  './js/edytor-zdjecia.js',
  './js/konfiguracja.js',
  './js/koszty.js',
  './js/nagrania.js',
  './js/pdf.js',
  './js/podpisy.js',
  './js/protokol.js',
  './js/pwa.js',
  './js/skaner.js',
  './js/testy-ai.js',
  './js/wersja.js',
  './js/zapis.js',
  './js/zdjecia-przegladu.js',
  './js/zdjecia.js',
  './lib/anthropic.js',
  './lib/czcionki/LiberationSans-Bold.ttf',
  './lib/czcionki/LiberationSans-BoldItalic.ttf',
  './lib/czcionki/LiberationSans-Italic.ttf',
  './lib/czcionki/LiberationSans-Regular.ttf',
  './lib/firebase.js',
  './lib/pdf-lib.js',
  './manifest.json',
]; // @pliki-koniec

const NAZWA_PAMIECI = `protokoly-${WERSJA}`;

// Instalacja nowej wersji: pobierz wszystkie pliki (z pominięciem pamięci przeglądarki,
// żeby nie zapisać przypadkiem starszych plików).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(NAZWA_PAMIECI).then((pamiec) =>
    pamiec.addAll(PLIKI.map((u) => new Request(u, { cache: 'reload' })))));
  // NIE aktywujemy od razu – czekamy, aż użytkownik dotknie „Odśwież”.
});

// Aktywacja: usuń pliki starych wersji.
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((nazwy) => Promise.all(nazwy.filter((n) => n.startsWith('protokoly-') && n !== NAZWA_PAMIECI).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

// Komunikaty z aplikacji.
self.addEventListener('message', (e) => {
  if (e.data === 'aktywuj') self.skipWaiting();
  if (e.data === 'wersja' && e.source) e.source.postMessage({ wersja: WERSJA });
});

// Pobieranie plików: pliki aplikacji z pamięci telefonu, reszta (Firebase, OpenAI,
// Anthropic) – zawsze z internetu, bez pośrednictwa.
self.addEventListener('fetch', (e) => {
  const zadanie = e.request;
  if (zadanie.method !== 'GET') return;
  const adres = new URL(zadanie.url);
  if (adres.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const pamiec = await caches.open(NAZWA_PAMIECI);
    // Strona startowa (także z dodatkami w adresie, np. ?emulator=1).
    if (zadanie.mode === 'navigate') {
      return (await pamiec.match('./', { ignoreSearch: true })) || fetch(zadanie);
    }
    const zapisany = await pamiec.match(zadanie, { ignoreSearch: true });
    if (zapisany) return zapisany;
    try {
      return await fetch(zadanie);
    } catch (blad) {
      return new Response('Brak połączenia', { status: 503, statusText: 'offline' });
    }
  })());
});

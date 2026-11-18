# CLAUDE.md – aplikacja „Protokoły”

## 0. Najważniejsze o współpracy
- Użytkownik (GitHub `Skuleczek`, administrator aplikacji) jest **początkujący**. Pisz **po polsku**, prostym językiem. **Przed każdym krokiem wyjaśnij, co robisz**, a na końcu **co musi zrobić sam** (np. wkleić reguły w Firebase, odświeżyć aplikację) i **jak to przetestować**.
- Nie buduj wszystkiego naraz. Gdy zmiana jest większa, pokaż krótko plan.
- Jest jedna gałąź `main`, a push na nią **od razu publikuje** aplikację (GitHub Pages). Przed każdym pushem uruchom `narzedzia/publikuj.sh` (patrz pkt 5).
- Mów uczciwie, co jest przetestowane (emulator, emulowany telefon), a czego nie da się sprawdzić tutaj (prawdziwy iPhone/Safari, prawdziwe klucze API).

## 1. Cel aplikacji
- PWA na telefon (Android i iPhone, także komputer) do **protokołów kontroli central wentylacyjnych** według wzoru firmy „FRAPOL” – Serwis (oryginał: plik xls „Protokół szczegółowy”, 13 sekcji, 43 punkty).
- Używa jej zespół serwisantów. Wszyscy pracują na **wspólnej bazie** (Firebase), każdy protokół ma autora i ostatniego edytującego.
- Główne funkcje:
  - Grupa (klient) → Przegląd (data) → Protokół (jedna centrala). Nazwa grupy = pole OBIEKT.
  - Ręczne wypełnianie: duże przyciski, „✓ Sekcja OK”, „brak”, punkty opcjonalne, „Zapisz i następna”, kopiowanie centrali z poprzedniego przeglądu, wyróżnianie braków.
  - **Głos:** nagranie → transkrypcja (OpenAI) → **Claude** zaznacza pola według zasad. Pola zmienione przez AI są wyróżnione tylko w aplikacji, są przyciski „Zatwierdź”/„Cofnij” i „✓ OK” przy oznaczeniach „do sprawdzenia”.
  - Bez zasięgu: dane i zmiany są w pamięci telefonu i wysyłają się same, nagrania czekają w kolejce.
  - **PDF** wyglądający jak oryginał: pojedynczy, z przeglądu, z grupy. Każdy protokół zaczyna się od nowej strony i ma własne „Strona 1”.
  - **Zdjęcia → PDF** ze skanerem: wykrywanie i prostowanie kartki, edycja rogów z lupą, filtry, obrót.
  - Logowanie **imieniem + jednorazowym 6-cyfrowym kodem** od administratora.
  - Panel administratora: użytkownicy i kody, klucze API, koszty, kopia zapasowa, test jakości AI.

## 2. Stack
- **Czysty HTML/CSS/JavaScript (moduły ES), bez frameworka i bez kroku budowania.** Pliki są serwowane wprost z repozytorium.
- Biblioteki są złożone esbuildem do pojedynczych plików w `lib/` (nie z CDN, żeby działało offline):
  - `lib/firebase.js`: Firebase JS SDK 13.4.0 (app, auth, firestore; eksportowane funkcje według `wejscie.js`, patrz pkt 5),
  - `lib/anthropic.js`: `@anthropic-ai/sdk` 1.10.0 (Apache 2.0). Klucz wysyła w `Authorization: Bearer` i tak ma być,
  - `lib/pdf-lib.js`: pdf-lib 1.17.1 + @pdf-lib/fontkit 1.1.1 (MIT),
  - `lib/czcionki/`: Liberation Sans (Regular/Bold/Italic/BoldItalic, SIL OFL), polskie znaki w PDF.
- Hosting: **GitHub Pages** → `https://skuleczek.github.io/protokoly/` (repo `Skuleczek/protokoly`, publiczne, bez licencji – świadomie).
- AI:
  - **Claude:** model `claude-sonnet-5-5` przez `client.beta.messages.create`, z `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`, `output_config: { effort: 'medium', format: { type: 'json_schema', schema } }`, `cache_control: ephemeral` na instrukcji systemowej i `dangerouslyAllowBrowser: true`. Bez `temperature`/`top_p`.
  - **OpenAI:** `POST /v1/audio/transcriptions`, model `gpt-transcribe` z automatycznym przejściem na `gpt-4o-transcribe` (wyłączany 26.02.2027), `language=pl`, `prompt`=słownik. Modele da się zmienić w aplikacji (Klucze API).

## 3. Struktura projektu
- `index.html`: jedna strona, manifest, ikony, `js/aplikacja.js`.
- `js/aplikacja.js`: **wszystkie ekrany** (routing po `location.hash`: `#/`, `#/grupa/ID`, `#/przeglad/ID`, `#/protokol/ID`, `#/pdf/przeglad|grupa/ID`, `#/zdjecia`, `#/ustawienia`, `#/slownik`, `#/instalacja`, `#/administrator`, `#/uzytkownicy`, `#/klucze`, `#/koszty`, `#/kopia`, `#/testai`). Przyciski mają `data-akcja="…"`, a obsługę zapewnia obiekt `akcje` (delegacja kliknięć). Tekst użytkownika zawsze przez `h()` (escapowanie).
- `js/protokol.js`: logika protokołu (szablon, „Sekcja OK”, opcjonalne, postęp/braki, `nowyProtokol`).
- `js/baza.js`: dostęp do danych. Kolekcje `grupy/przeglady/protokoly` idą do Firestore (zapis bez czekania na serwer, odczyt z limitem 4 s i powrotem do pamięci podręcznej). `ustawienia/nagrania` są lokalnie w IndexedDB `protokoly`, a gdy IndexedDB nie działa, w pamięci.
- `js/chmura.js`: init Firebase, sesja, logowanie kodem, pierwsze konto administratora, operacje administratora (konta, kody, blokada). Ma tryb awaryjny `memoryLocalCache`, gdy IndexedDB nie działa (np. Safari prywatne).
- `js/konfiguracja.js`: konfiguracja Firebase (jawna z założenia), ważność kodu (48 h), cennik `CENY` do panelu kosztów.
- `js/nagrania.js`: nagrywanie (MediaRecorder, wake lock), kolejka offline, transkrypcja, klucze (`sekrety/klucze`), tryb testowy, słownik, zapis zużycia.
- `js/ai.js`: instrukcja systemowa z zasadami, schemat JSON z szablonu, wywołanie Claude, `zastosujWynik`, `cofnijAI` (cofa tylko pola zmienione przez AI), sprawdzanie klucza.
- `js/testy-ai.js`: 13 scenariuszy „Test jakości AI” (ostatni wynik u użytkownika: 38/38; od dodania pola pomieszczenia jest 39 sprawdzeń).
- `js/pdf.js`: PDF protokołu. Wymiary zmierzone z oryginału (stała `K`). **Nie pokazuje oznaczeń AI ani flag.**
- `js/zdjecia.js`, `js/skaner.js`, `js/edytor-zdjecia.js`: Zdjęcia → PDF i skaner. Edytor `edytujZdjecia(lista, start)` obsługuje wszystkie zdjęcia (strzałki ◀/▶, „Zastosuj filtr dla wszystkich”, Anuluj odrzuca całą edycję). Filtr jest osobny dla każdego zdjęcia, a chipy na ekranie głównym ustawiają filtr dla nowych zdjęć. „👁 Podgląd” pokazuje strony A4 (`ukladStrony` wspólny z PDF) (wykrywanie kartki, homografia, filtry `oryginal|kontrast|szarosc|dokument|czarnobialy`, obrót).
- `js/koszty.js`: podsumowanie zużycia, szacowane saldo i data końca środków.
- `js/pwa.js`, `sw.js`, `manifest.json`, `ikony/`: instalacja, offline, pasek „Jest nowa wersja”. `js/wersja.js` jest generowany automatycznie.
- `dane/szablon.json`: struktura protokołu (jedno źródło dla formularza, PDF i AI). `dane/slownik-startowy.json`: startowy słownik.
- `firestore.rules`: reguły bezpieczeństwa. `narzedzia/`: `publikuj.sh`, `sprawdz-klucze.sh`. `PLAN.md`: etapy.
- `css/styl.css`: cały wygląd.

## 4. Firebase (projekt `protokoly-a15a9`)
- Usługi: **Authentication** (tylko „Anonymous”, autoryzowana domena `skuleczek.github.io`) i **Cloud Firestore** (Standard, `europe-central2`, plan darmowy Spark). **Bez** Firebase Hosting i Realtime Database.
- Logowanie: urządzenie loguje się anonimowo (uid), ale **dostęp daje dopiero przypisanie urządzenia do konta kodem**. Robi to batch: `set urzadzenia/{uid}` + `delete kody/{konto}_{kod}` (kod zużywa się atomowo). Pierwsze konto administratora powstaje tylko, gdy nie ma `konfiguracja/zalozono`. Sesja jest zapamiętana w `localStorage.sesja` (do pracy offline).
- Kolekcje:
  - `konfiguracja/zalozono`,
  - `konta/{kontoId}` {imie, admin, aktywny}, gdzie `kontoId = idKonta(imie)`: małe litery, bez polskich znaków, myślniki,
  - `kody/{kontoId}_{kod}` {konto, wazneDo},
  - `urzadzenia/{uid}` {konto, kod, opis, utworzono},
  - `grupy/{id}`, `przeglady/{id}` {grupaId, data},
  - `protokoly/{id}`: naglowek (typ, nrFabr, rok, oznaczenie, opcjonalne `pomieszczenie` = pomieszczenie/piętro; w PDF w wierszu OZNACZENIE komórka I2 oryginału = kolumna I, x=400 jak pole „nastawa”; przy długim oznaczeniu przesuwa się w prawo), sekcje, punkty (`stan poz|neg`, `dod`, `rozmiar`, `pobor/znamionowy/bezpiecznik`), termin, uwagi, flagi, transkrypcje (ai: czeka|gotowe|blad), ostatnieAI, autor/autorImie, zmienil/zmienilImie, dataKontroli, podpis (na przyszłość),
  - `sekrety/klucze`: klucze API i modele, ważność kluczy (**opcja A**: czytają wszyscy członkowie, pisze administrator),
  - `wspolne/slownik`: terminy; czyta i pisze każdy członek, podpisany polem `zmienil`,
  - `admin/budzet`: saldo, kurs; tylko administrator,
  - `zuzycie/{id}`: rodzaj transkrypcja|ai|ai-test, tokeny/sekundy, konto, miesiac, kiedy.
- Uprawnienia: wszyscy członkowie widzą i edytują wszystkie protokoły. Usuwać mogą autor (własne) i administrator (wszystko: grupy, przeglądy, cudze). Autora nie da się podmienić. Zablokowane konto natychmiast traci dostęp.
- **Każda zmiana `firestore.rules` wymaga, by użytkownik wkleił plik w Firebase → Firestore Database → Rules → Publish.** Zawsze mu o tym przypomnij. Przed wysłaniem przetestuj reguły na emulatorze (ostatnio 55/55).

## 5. Uruchamianie, testy, publikacja
- Lokalnie: `python3 -m http.server 8123` w folderze repo → `http://localhost:8123/`. Dodatek `?emulator=1` (tylko na localhost) łączy z emulatorami (auth 9099, firestore 8180).
- Narzędzia testowe są poza repo, w scratchpadzie, i znikają przy nowej sesji. Do odtworzenia:
  - `npm i firebase@13 esbuild firebase-tools@15 @firebase/rules-unit-testing` (osobno, bo jest konflikt wersji: `npm i pdf-lib @pdf-lib/fontkit @anthropic-ai/sdk esbuild`),
  - `firebase.json` z `"firestore": {"rules": "<repo>/firestore.rules"}`, emulatory firestore 8180 i auth 9099,
  - uruchamianie: `npx firebase emulators:exec --only firestore,auth --project protokoly-a15a9 "node test.js"` (Java jest, jar emulatora pobiera się sam),
  - testy przeglądarkowe: Playwright z preinstalowanym Chromium, `devices['Pixel 7' | 'iPhone 14']`. **WebKit/Safari nie jest dostępny.**
- Przebudowa bibliotek (esbuild `--bundle --format=esm --minify --legal-comments=eof`):
  - Firebase, `wejscie.js` eksportuje: `initializeApp; getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator, signOut; initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, connectFirestoreEmulator, doc, collection, getDoc, getDocs, getDocFromCache, getDocsFromCache, setDoc, deleteDoc, query, where, writeBatch, serverTimestamp, Timestamp, onSnapshotsInSync, waitForPendingWrites, updateDoc, arrayUnion`,
  - Anthropic: `export { default as Anthropic } from '@anthropic-ai/sdk'` (`--platform=browser`),
  - pdf-lib: `export { PDFDocument, rgb, PageSizes } from 'pdf-lib'; export { default as fontkit } from '@pdf-lib/fontkit'`.
- **Publikacja:** `./narzedzia/publikuj.sh` (nowy numer wersji, lista plików w `sw.js` i `js/wersja.js`, sprawdzenie kluczy) → commit → `git push origin main`. Bez publikuj.sh telefony nie zobaczą aktualizacji.
- Commity: `git -c user.name="Skuleczek" -c user.email="Skuleczek@users.noreply.github.com" commit`, opis po polsku, na końcu stopka atrybucji z bieżącej sesji (jeśli jest podana).

## 6. Zasady i konwencje
- **Interfejs wyłącznie po polsku.** Kod: nazwy po polsku bez ogonków (`zapiszTeraz`, `ekranProtokol`), komentarze po polsku, wcięcia 2 spacje, apostrofy, średniki.
- Wygląd: prosty, duże przyciski (min. 56 px, w rękawiczkach), wysoki kontrast, kolory w zmiennych CSS (`--niebieski #0b4f8a`, `--zielony`, `--czerwony`). Liczby po polsku (przecinek, `toLocaleString('pl-PL')`).
- Nazwa w aplikacji/linku: „Protokoły kontroli” / „Protokoły”. **„FRAPOL” tylko w nagłówku PDF** (`szablon.firma`), nigdzie indziej (tytuł strony, słownik).
- PDF: nazwy plików „<nazwa grupy> <dd.mm.rrrr>.pdf” (pojedynczy protokół: + oznaczenie centrali), ze spacjami i bez myślników. Przy zapisie polskie litery zamieniane na zwykłe (Chrome zmienia nazwy z polskimi literami na „download”). Kopia zapasowa: „Kopia protokolow <data>.json”.
- PDF protokołu: zaznaczenie = krzyżyk, rozmiar łożyska w kratce „do wymiany” (z małym ✕, gdy zaznaczone), przy podpisie tylko data (bez „wykonał”, bez linii „podpis”).
- Logowanie: **samo imię** (bez nazwiska). Przy powtórzonych imionach administrator dodaje literę, np. „Jan K.”.
- Dla wszystkich: Ustawienia = tryb testowy, słownik (edytuje każdy), wersja, instalacja. **Tylko administrator:** użytkownicy i kody, klucze API (z ważnością w dniach, ostrzeżenie 14 dni przed końcem), koszty, kopia zapasowa (przypomnienie po 14 dniach, widoczne tylko u administratora), test jakości AI.
- Punkty opcjonalne: 1.4, 2.4, 3.3 i nastawa bezpiecznika 1.6/2.6. „Sekcja OK” ich nie zaznacza, wpisanie nastawy w 1.4/2.4 zaznacza „poprawne”. 1.5/2.5 mają pole „rozmiar łożyska”.
- Zasady AI (w `js/ai.js`): cała sekcja OK → wszystkie pozytywne; wyjątki nadpisują; „brak” → podpunkty puste; liczb nigdy nie zgaduje (oznacza „uzupelnij”); niejasne → „sprawdz” z cytatem; uwagi redagowane rzeczowo; kolejne nagrania nadpisują. Po zmianach w instrukcji poproś użytkownika o „🛠 Administrator → 🧪 Test jakości AI” i wklejenie raportu.

## 7. Czego unikać (błędy, które już były)
- **Nigdy nie umieszczaj kluczy API w repo ani w czacie.** Przed pushem zawsze `sprawdz-klucze.sh` (zrobi to `publikuj.sh`). Konfiguracja Firebase (`AIza…`) jest jawna i może być w repo.
- Nie czekaj (`await`) na zapis Firestore w zwykłej pracy, bo bez internetu aplikacja się zawiesi. Używaj `baza.zapisz`.
- Android: wybór plików przez **prawdziwy `<input type=file>` w `<label>`**, nie przez programowe `.click()` na ukrytym polu (na części telefonów nie działało).
- Service worker: **nie przeładowuj strony przy pierwszej aktywacji** (tylko po „Odśwież”, flaga `odswiezanie`). Pliki do cache pobieraj z `cache: 'reload'`.
- iPhone: Safari i aplikacja z ikony mają **osobne dane i logowanie**, a kod jest jednorazowy, więc najpierw ikona, potem logowanie z ikony. Pole kodu bez `maxlength`, bo spacje są usuwane. Pole imienia bez autokorekty.
- „Cofnij” AI ma przywracać tylko pola zmienione przez AI, nie ręczne poprawki.
- Testy Playwright: po nawigacji czekaj na element **docelowego** ekranu (inaczej kliknięcia trafiają w poprzedni ekran). Uważaj na zduplikowane selektory (np. filtry w edytorze i pod nim).
- Nie zmieniaj struktury `dane/szablon.json` bez sprawdzenia formularza, PDF, schematu AI (`kluczePol`) i istniejących protokołów.
- `request_credential` nie działa dla `api.anthropic.com`, a sesja nie ma własnego klucza. Jakość AI testuje się ekranem „Test jakości AI” w aplikacji. Dokumentacja OpenAI (`platform.openai.com`, `developers.openai.com`) jest stąd zablokowana.
- Nie używaj złożonych poleceń z `rm -rf` na zmiennych (blokuje je zabezpieczenie). Nie ruszaj `konfiguracja.js` (projekt Firebase) bez wyraźnej prośby.

## 8. Stan prac (18.11.2026, wersja 2026.11.18-1024)
- ✅ Etapy 1–7 z `PLAN.md`: formularz i grupy, wspólna baza i logowanie, PDF i Zdjęcia → PDF, nagrywanie i transkrypcja, wypełnianie przez Claude, panel administratora (koszty, kopia, słownik, test AI), PWA (instalacja, offline, aktualizacje), skaner zdjęć.
- 🔄 W trakcie / do potwierdzenia przez użytkownika:
  - **logowanie kodem na iPhonie (Safari)**: poprawki wysłane, czekamy na wynik. Jeśli dalej nie działa, poproś o zrzut nowego komunikatu (pokazuje imię, kod, kod błędu) i wersję iOS,
  - testy w terenie: jakość transkrypcji i AI na prawdziwym dyktowaniu, praca bez zasięgu, skaner na prawdziwych zdjęciach,
  - użytkownik musi mieć wklejoną **aktualną** wersję `firestore.rules` w Firebase.
- ⏭ Dalej: poprawki instrukcji AI po testach w terenie (każdy błędny przypadek dopisać też do `js/testy-ai.js`), ewentualne dopracowanie wykrywania kartki, **podpis palcem** (w PDF jest miejsce, pole `protokol.podpis`), ewentualnie aktualizacja cennika `CENY`.

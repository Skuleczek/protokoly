# Plan aplikacji „Protokoły kontroli”

Aplikacja na telefon (PWA) do protokołów kontroli central wentylacyjnych.
Hosting: GitHub Pages · Baza i logowanie: Firebase · Transkrypcja: OpenAI · Wypełnianie: Claude (Anthropic).

## Etapy

| # | Etap | Stan |
|---|------|------|
| 1 | Szablon protokołu, ręczne wypełnianie, grupy, przeglądy, „Zapisz i następna”, kopiowanie centrali z poprzedniego przeglądu | ✅ gotowe |
| 1b | Wspólna baza (Firebase), logowanie imieniem + jednorazowym kodem, panel użytkowników, autor protokołu | ✅ gotowe |
| 2 | PDF jak oryginalny protokół (pojedynczy, z przeglądu, z grupy) + „Zdjęcia → PDF” | ✅ gotowe |
| 3 | Nagrywanie, kolejka bez zasięgu, transkrypcja OpenAI, klucze API z licznikiem ważności, tryb testowy | ✅ gotowe |
| 4 | Claude wypełnia protokół z nagrania (zasady interpretacji, prompt caching, wyróżnienie zmian AI tylko w aplikacji, „Zatwierdź”/„Cofnij”, „✓ OK” przy oznaczeniach) | ✅ gotowe (czeka na test z prawdziwymi kluczami) |
| 5 | Panel administratora: koszty (zużycie na osobę/dzień, saldo, data końca środków, ważność kluczy), kopia zapasowa z przypomnieniem, test jakości AI; słownik terminów edytowalny przez wszystkich (Ustawienia) | ✅ gotowe |
| 6 | Instalacja na ekranie głównym (ikona, manifest), uruchamianie bez internetu (service worker), pasek „Jest nowa wersja”, numer wersji, instrukcje Android/iPhone/komputer, ostrzeżenie dla iPhone | ✅ gotowe |
| 7 | Skaner w „Zdjęcia → PDF”: automatyczne wykrywanie i prostowanie kartki, edycja rogów z lupą, obrót, filtry (kontrast, szarość, dokument, czarno-biały). Wszystko w telefonie – bez kosztów i tokenów | ✅ gotowe |

## Pomysły na później
- Podpis palcem w aplikacji (PDF ma już przygotowane miejsce).

## Zasady bezpieczeństwa
- Klucze API nigdy nie trafiają do repozytorium (`narzedzia/sprawdz-klucze.sh` przed każdą publikacją).
- Przed każdą publikacją: `narzedzia/publikuj.sh` – nowy numer wersji + lista plików w `sw.js` (bez tego telefony nie zobaczą aktualizacji) + sprawdzenie kluczy.
- Reguły dostępu do bazy: `firestore.rules` (wklejane w Firebase → Firestore → Rules).

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
| 5 | Panel kosztów dla administratora (zużycie, saldo, data końca środków, ważność kluczy), edytowalny słownik, kopia zapasowa | ⬜ |
| 6 | Instalacja na ekranie głównym, pełne działanie offline, automatyczne aktualizacje, instrukcja Android/iPhone | ⬜ |
| 7 | Skaner w „Zdjęcia → PDF”: automatyczne kadrowanie kartki i prostowanie perspektywy, ręczne przycinanie każdego zdjęcia (4 rogi), filtry (szarość, czarno-biały „skan”, kontrast). Wszystko w telefonie – bez kosztów i tokenów | ⬜ |

## Pomysły na później
- Podpis palcem w aplikacji (PDF ma już przygotowane miejsce).

## Zasady bezpieczeństwa
- Klucze API nigdy nie trafiają do repozytorium (`narzedzia/sprawdz-klucze.sh` przed każdą publikacją).
- Reguły dostępu do bazy: `firestore.rules` (wklejane w Firebase → Firestore → Rules).

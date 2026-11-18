#!/usr/bin/env bash
# ============================================================
# Przygotowanie nowej wersji do publikacji:
#  1. nadaje numer wersji (data-godzina),
#  2. wpisuje do sw.js listę plików aplikacji (zapis w telefonie / offline),
#  3. zapisuje numer wersji w js/wersja.js (widoczny w Ustawieniach),
#  4. wpisuje numer wersji do nowego wpisu w dane/zmiany.json ("wersja": "NOWA"),
#  5. sprawdza, czy w plikach nie ma kluczy API.
# Po nim: git add -A && git commit && git push.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

WERSJA="$(TZ=Europe/Warsaw date +%Y.%m.%d-%H%M)"
PLIKI="$( { echo index.html; echo manifest.json; git ls-files -co --exclude-standard css js lib dane ikony; } \
  | grep -vE '\.(txt|md)$' | sort -u )"

python3 - "$WERSJA" "$PLIKI" <<'PY'
import re, sys
wersja, pliki = sys.argv[1], sys.argv[2].split()
sw = open('sw.js', encoding='utf-8').read()
sw = re.sub(r"const WERSJA = '[^']*'; // @wersja", f"const WERSJA = '{wersja}'; // @wersja", sw)
lista = "\n".join(["  './',"] + [f"  './{p}'," for p in pliki])
sw = re.sub(r"(const PLIKI = \[ // @pliki-start\n).*?(\]; // @pliki-koniec)", lambda m: m.group(1) + lista + "\n" + m.group(2), sw, flags=re.S)
open('sw.js', 'w', encoding='utf-8').write(sw)
# Lista zmian: wpis "NOWA" dostaje numer tej wersji.
zm = open('dane/zmiany.json', encoding='utf-8').read()
if '"wersja": "NOWA"' in zm:
    open('dane/zmiany.json', 'w', encoding='utf-8').write(zm.replace('"wersja": "NOWA"', f'"wersja": "{wersja}"', 1))
    print('Lista zmian: dopisano numer wersji do najnowszego wpisu.')
else:
    print('UWAGA: brak nowego wpisu "NOWA" w dane/zmiany.json – lista zmian nie opisuje tej wersji.')
open('js/wersja.js', 'w', encoding='utf-8').write(
    "// Numer wersji – uzupełniany automatycznie przez narzedzia/publikuj.sh\n"
    f"export const WERSJA = '{wersja}';\n")
print(f"Wersja {wersja}, plików do zapisu w telefonie: {len(pliki) + 1}")
PY

./narzedzia/sprawdz-klucze.sh

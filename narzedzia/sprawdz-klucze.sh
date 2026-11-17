#!/usr/bin/env bash
# Sprawdza, czy w plikach przeznaczonych do publikacji nie ma kluczy API.
# Uruchamiane przed każdą publikacją. Kod wyjścia 1 = znaleziono coś podejrzanego.
cd "$(dirname "$0")/.."
WZORZEC='sk-ant-[A-Za-z0-9_-]{10,}|sk-(proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}'
if git ls-files -co --exclude-standard | xargs -r grep -nIE "$WZORZEC" ; then
  echo "❌ UWAGA: znaleziono coś, co wygląda jak klucz API. Publikacja wstrzymana."
  exit 1
fi
echo "✅ Brak kluczy API w plikach do publikacji."

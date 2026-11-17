// ============================================================
// koszty.js – panel kosztów administratora.
// Każde nagranie i każde wypełnienie przez AI zapisuje wpis w kolekcji
// "zuzycie" (minuty / tokeny). Tutaj zamieniamy je na USD i zł.
// Ceny: konfiguracja.js (orientacyjne – dokładne kwoty w panelach dostawców).
// ============================================================

import { fs, F } from './chmura.js';
import { CENY } from './konfiguracja.js';

export function kosztWpisu(z) {
  if (z.rodzaj === 'transkrypcja') {
    const cena = CENY.transkrypcja[z.model] ?? CENY.transkrypcja.domyslna;
    return { serwis: 'openai', usd: ((z.sekundy || 0) / 60) * cena };
  }
  const c = CENY.ai[z.model] || CENY.ai.domyslna;
  const usd = ((z.wejscie || 0) * c.wejscie + (z.wyjscie || 0) * c.wyjscie
    + (z.cacheOdczyt || 0) * c.cacheOdczyt + (z.cacheZapis || 0) * c.cacheZapis) / 1e6;
  return { serwis: 'anthropic', usd };
}

const kiedyMs = (z) => (z.kiedy && z.kiedy.toMillis ? z.kiedy.toMillis() : Date.now());
const dzien = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function zuzycieMiesiaca(miesiac) {
  const w = await F.getDocs(F.query(F.collection(fs, 'zuzycie'), F.where('miesiac', '==', miesiac)));
  return w.docs.map((d) => d.data());
}
export async function zuzycieOd(ms) {
  const w = await F.getDocs(F.query(F.collection(fs, 'zuzycie'), F.where('kiedy', '>=', F.Timestamp.fromMillis(ms))));
  return w.docs.map((d) => d.data());
}

export function podsumuj(wpisy) {
  const wynik = {
    openai: 0, anthropic: 0, minuty: 0, wypelnienia: 0, testy: 0, kosztTestow: 0, osoby: {}, dni: {},
  };
  for (const z of wpisy) {
    const { serwis, usd } = kosztWpisu(z);
    wynik[serwis] += usd;
    if (z.rodzaj === 'transkrypcja') wynik.minuty += (z.sekundy || 0) / 60;
    else if (z.rodzaj === 'ai-test') { wynik.testy++; wynik.kosztTestow += usd; }
    else wynik.wypelnienia++;
    const o = z.imie || z.konto || '?';
    wynik.osoby[o] = (wynik.osoby[o] || 0) + usd;
    const d = dzien(kiedyMs(z));
    wynik.dni[d] = (wynik.dni[d] || 0) + usd;
  }
  wynik.razem = wynik.openai + wynik.anthropic;
  return wynik;
}

// ------------------------------------------------------------
// Budżet: stan konta wpisany przez administratora + kurs USD
// admin/budzet = { kurs, anthropic: { saldo, data }, openai: { saldo, data }, ostatniaKopia }
// ------------------------------------------------------------
export async function pobierzBudzet() {
  try {
    const d = await F.getDoc(F.doc(fs, 'admin', 'budzet'));
    return (d.exists() && d.data()) || {};
  } catch (e) { return {}; }
}
export async function zapiszBudzet(zmiany) {
  const obecny = await pobierzBudzet();
  await F.setDoc(F.doc(fs, 'admin', 'budzet'), { ...obecny, ...zmiany });
}

/**
 * Szacowane saldo i data końca środków dla jednej usługi.
 * @returns {{saldo, zuzyte, pozostalo, dziennie, dniDoKonca, koniec} | null}
 */
export async function szacujSaldo(budzet, serwis) {
  const b = budzet[serwis];
  if (!b || !Number.isFinite(b.saldo) || !b.data) return null;
  const DNI_SREDNIEJ = 14;
  const od = Math.min(b.data, Date.now() - DNI_SREDNIEJ * 86400000);
  const wpisy = (await zuzycieOd(od)).filter((z) => kosztWpisu(z).serwis === serwis);
  const zuzyte = wpisy.filter((z) => kiedyMs(z) >= b.data).reduce((s, z) => s + kosztWpisu(z).usd, 0);
  const ostatnie = wpisy.filter((z) => kiedyMs(z) >= Date.now() - DNI_SREDNIEJ * 86400000);
  const dniDanych = Math.max(1, Math.min(DNI_SREDNIEJ, (Date.now() - Math.min(...ostatnie.map(kiedyMs), Date.now())) / 86400000));
  const dziennie = ostatnie.reduce((s, z) => s + kosztWpisu(z).usd, 0) / dniDanych;
  const pozostalo = b.saldo - zuzyte;
  const dniDoKonca = dziennie > 0 ? Math.max(0, pozostalo / dziennie) : null;
  return {
    saldo: b.saldo, data: b.data, zuzyte, pozostalo, dziennie, dniDoKonca,
    koniec: dniDoKonca !== null ? Date.now() + dniDoKonca * 86400000 : null,
  };
}

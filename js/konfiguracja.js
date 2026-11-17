// Konfiguracja Firebase – NIE jest tajna (Google udostępnia ją z każdą stroną).
// Dane chroni plik firestore.rules (reguły wykonywane na serwerze).
// Tajne klucze (Anthropic, OpenAI) NIGDY nie trafiają do tego pliku.
export const KONFIG_FIREBASE = {
  apiKey: 'AIzaSyCvT_HbdF5J8Ua9h556b23RGM8TOyqqWzE',
  authDomain: 'protokoly-a15a9.firebaseapp.com',
  projectId: 'protokoly-a15a9',
  storageBucket: 'protokoly-a15a9.firebasestorage.app',
  messagingSenderId: '816256481807',
  appId: '1:816256481807:web:b33ff9585c439eef73017a',
};

// Ile godzin ważny jest kod zaproszenia.
export const WAZNOSC_KODU_GODZ = 48;

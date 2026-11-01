# SZKUDEK COMMANDCENTER

Statyczny pulpit z linkami, radiem, notatnikiem i zadaniami. Nie wymaga serwera aplikacji ani instalowania zależności.

## Używanie

- **Zadania:** dodawanie i odhaczanie zadań dla wybranego dnia, postęp oraz dostęp do wcześniejszych dni. Nowy dzień nie usuwa historii. Limit: 1000 zadań.
- **Sekcje:** przycisk „Sekcje” dodaje własne kategorie i zmienia nazwy istniejących. Usunięcie własnej sekcji przenosi jej kafelki do pierwszej sekcji. Limit: 30 własnych sekcji.
- **Kafelki:** w trybie edycji przycisk ↗ przenosi kafelek do innej sekcji; ulubione zachowują powiązanie. Panel grupowy GeoGames pozostaje w Gaming Arena.
- **Wyszukiwanie:** `/` ustawia fokus, `Esc` czyści pole, `Enter` otwiera jedyny pasujący adres. Powtórzenia w ulubionych nie liczą się jako dodatkowy wynik. Linki pod polem wyszukują w Google i YouTube.
- **Tryb kompaktowy:** mniejszy nagłówek, kafelki i odstępy; wybór jest zapamiętywany.
- **Notatnik:** wyszukiwanie po tytule, kategorii i treści, przypinanie notatek oraz eksport pojedynczej notatki jako tekstu.
- **Kopie:** domyślnie szyfrowane hasłem (minimum 12 znaków). Można wybrać zwykły JSON i pominąć notatki. Import bez notatek zachowuje aktualny notatnik. Przed przywróceniem widać podsumowanie i domeny importowanych adresów. Starsze kopie JSON pozostają obsługiwane.
- **Przypomnienie:** po 50 zapisanych zmianach pojawia się przypomnienie o pełnej kopii. Można odłożyć je o kolejne 50 zmian. Eksport z pominięciem notatek nie zeruje przypomnienia o pełnej kopii.

## Dane i bezpieczeństwo

Dane pozostają w `localStorage` tej przeglądarki i nie są synchronizowane z GitHubem. Szyfrowanie dotyczy **pliku kopii**, nie lokalnego notatnika. Hasło nie jest zapisywane. Utraconego hasła nie da się odzyskać. Dane witryn pod tym samym originem współdzielą przestrzeń `localStorage`; osobna domena zapewnia oddzielenie od pozostałych aplikacji.

Szyfrowanie korzysta z Web Crypto: AES-GCM-256, losowy salt 16 bajtów, losowy IV 12 bajtów, PBKDF2-SHA-256 (310000 iteracji). Odszyfrowanie lub walidacja błędnej kopii nie zastępuje obecnych danych. Limit pliku importu: 16 MB. HTTPS lub localhost jest wymagany do szyfrowania.

## Sprawdzenie lokalne

```sh
python3 -m http.server 8765
# Otwórz http://localhost:8765/
node --test tests/security.mjs
```

Testy wymagają Node.js 22 lub nowszego i sprawdzają zgodność starych danych, walidację nowych pól, niebezpieczne adresy oraz szyfrowanie i wykrywanie uszkodzonych kopii.

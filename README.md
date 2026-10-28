# IzzyCheck — Weryfikacja Wyceny i Historii Szkód VIN

IzzyCheck to wewnętrzna aplikacja B2B dla operatorów Izzy Lease, służąca do ustandaryzowanego tworzenia raportów weryfikacji pojazdów na podstawie numeru VIN i daty pierwszej rejestracji.

Aplikacja integruje się z dwoma podsystemami SOAP dostawcy **Audatex / Solera**:
1. **AudaValuation WS 2023** — identyfikacja po VIN (`GetCarByVinWs`), kalkulacja wyceny rynkowej `COBv`, wartości technicznej `THv`, nowej ceny `CVv` (`EvaluateCarFull`), oraz dane techniczne i wyposażenie (`GetClassificationByIBSCode`).
2. **Claims History Engine B2B SOAP v1.23.0** — weryfikacja istnienia szkód (`hasHistory`), chronologiczna lista szkód (`getDetails`), dekodowanie mandatów (FRS/FRH, USA, BEL, AGS, GOC, DTS), 28 stref uszkodzeń nadwozia/szyb oraz istotnych grup części (001-015).

---

## 🔒 Bezpieczeństwo & Wymagane Zmienne Środowiskowe

Kod źródłowy **nie zawiera żadnych wbudowanych haseł ani stałych kluczy JWT**. Wszystkie sekrety muszą być przekazane wyłącznie w konfiguracji produkcyjnej Coolify.

- `DATABASE_URL`: Wymagany ciąg połączenia do bazy PostgreSQL.
- `POSTGRES_PASSWORD`: Hasło bazy PostgreSQL w kontenerze.
- `JWT_SECRET`: Wymagany unikalny klucz szyfrowania tokenów sesji.
- `INITIAL_ADMIN_EMAIL` i `INITIAL_ADMIN_PASSWORD`: Opcjonalne parametry do utworzenia pierwszego konta administratora przy czystej bazie danych.
- `AUDATEX_MOCK_MODE`: Domyślnie `false` (wymusza żywe wywołania SOAP Audatex). Ustaw `true` wyłącznie dla lokalnego środowiska testowego z fixture'ami XML.
- `AUDATEX_CHE_USERNAME`, `AUDATEX_CHE_PASSWORD`, `AUDATEX_CERTIFICATE_HASH`, `AUDATEX_LICENCE_NUMBER`: Produkcyjne poświadczenia Audatex.
- `AUDATEX_MARKET_CODE` (domyślnie `PL`) & `AUDATEX_LANGUAGE` (domyślnie `PL`).

---

## 🚀 Instrukcja Wdrożenia w Coolify v4

Ze względu na to, że repozytorium zawiera pliki źródłowe oraz `Dockerfile` i `docker-compose.yml`:

1. W Coolify dodaj nowy zasób typu **Application** podłączony do tego repozytorium Git (`github/izzycheck`).
2. Ustaw **Build Pack** na **Docker Compose**.
3. W konfiguracji wdrożenia upewnij się, że **Docker Compose Location** ma wartość `/docker-compose.yml`.
4. Baza danych PostgreSQL oraz aplikacja uruchomią się w prywatnej sieci kontenerowej. Port bazy 5432 nie jest wystawiany publicznie ze względów bezpieczeństwa.
5. Podczas pierwszego uruchomienia skrypt `docker-entrypoint.sh` automatycznie wykona `npx prisma migrate deploy` oraz zepnie migracje.

---

## 💳 Kredyty (rozliczenia raportów)

Każda organizacja ma jeden z dwóch trybów rozliczeń:

- **Prepaid (kredyty)** — moduły raportu zużywają kredyty z salda organizacji.
- **Bez limitu** — moduły nie zużywają kredytów (zachowanie sprzed wprowadzenia kredytów).

Kredyty są prowadzone per organizacja w dwóch typach: **Wycena** (moduł `VALUATION`) i **Szczegóły szkód** (moduł `CLAIM_DETAILS`). Sprawdzenie szkód (`CLAIM_CHECK`) jest bezpłatne.

Zasady naliczania:
- Kredyt jest rezerwowany przy starcie modułu i pobierany dopiero za dostarczony wynik.
- Błąd, brak danych lub 0 szkód = brak opłaty (rezerwacja jest zwracana).

**Faza 1:** doładowanie salda wyłącznie ręcznie przez admina (panel: Organizacje → Kredyty). Zakup online (PayU) i faktury (Fakturownia) pojawią się w kolejnych fazach.

### Lista kontrolna wdrożenia

1. Po deployu wszystkie istniejące organizacje mają tryb „Bez limitu”.
2. Przed przełączeniem pierwszej organizacji na Prepaid admin przypisuje konta bez organizacji (OPERATOR, konta sprzed B2B) do firm.
3. Zasil saldo klienta w panelu admina przed przełączeniem trybu.

---

## 💻 Uruchomienie Lokalnie i Testy

```bash
# 1. Zainstaluj zależności
npm install

# 2. Wygeneruj klienta Prisma
npx prisma generate

# 3. Uruchom testy jednostkowe parsera SOAP Audatex
npm test

# 3a. Uruchom testy z bazą danych (Docker, baza `izzycheck_test`)
npm run test:db

# 4. Uruchom serwer deweloperski
npm run dev
```

Po uruchomieniu przejdź pod `http://localhost:3000`.

`npm run test:db` uruchamia testy na prawdziwym Postgresie (`docker-compose.test.yml`, domyślnie `localhost:54329`). Nazwa bazy testowej (także w `TEST_DATABASE_URL`) musi kończyć się na `_test` — inaczej testy odmówią uruchomienia.

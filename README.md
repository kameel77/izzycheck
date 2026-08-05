# IzzyCheck — Weryfikacja Wyceny i Historii Szkód VIN

IzzyCheck to wewnętrzna aplikacja B2B dla operatorów Izzy Lease, służąca do ustandaryzowanego tworzenia raportów weryfikacji pojazdów na podstawie numeru VIN i daty pierwszej rejestracji.

Aplikacja integruje się z dwoma podsystemami SOAP dostawcy **Audatex / Solera**:
1. **AudaValuation WS 2023** — identyfikacja po VIN (`GetCarByVinWs`), kalkulacja wyceny rynkowej `COBv`, wartości technicznej `THv`, nowej ceny `CVv` (`EvaluateCarFull`), oraz dane techniczne i wyposażenie (`GetClassificationByIBSCode`).
2. **Claims History Engine B2B SOAP v1.23.0** — weryfikacja istnienia szkód (`hasHistory`), chronologiczna lista szkód (`getDetails`), dekodowanie mandatów (FRS/FRH, USA, BEL, AGS, GOC, DTS), 28 stref uszkodzeń nadwozia/szyb oraz istotnych grup części (001-015).

---

## 🚀 Wdrożenie na Coolify (VPS Hetzner)

Wszystkie pliki aplikacji znajdują się w niniejszym repozytorium (`github/izzycheck`).

### Instrukcja konfiguracji w Coolify v4:
1. W Coolify utwórz nowy projekt i dodaj **Application** podłączony do tego repozytorium Git (`github/izzycheck`).
2. Jako **Build Pack** wybierz **Docker Compose** lub **Dockerfile**.
3. Upewnij się, że lokalizacja pliku Docker Compose w panelu Coolify to `/docker-compose.yml` lub `/Dockerfile`.
4. Skonfiguruj zmienne środowiskowe z pliku `.env.example`:
   - `DATABASE_URL`: Połączenie do PostgreSQL
   - `JWT_SECRET`: Klucz szyfrowania tokenów
   - `AUDATEX_MOCK_MODE`: Ustaw `true` dla danych demonstracyjnych / testów fixture, lub `false` dla produkcyjnych SOAP Audatex.
   - `AUDATEX_CHE_USERNAME`, `AUDATEX_CHE_PASSWORD`, `AUDATEX_CERTIFICATE_HASH`, `AUDATEX_LICENCE_NUMBER`: Produkcyjne poświadczenia Audatex.

---

## 💻 Uruchomienie Lokalnie

```bash
# 1. Zainstaluj zależności
npm install

# 2. Wygeneruj klienta Prisma DB
npx prisma generate

# 3. Uruchom testy jednostkowe parsera SOAP Audatex
npm run test

# 4. Uruchom serwer deweloperski
npm run dev
```

Po uruchomieniu przejdź pod `http://localhost:3000`.

### Dane logowania demo:
- **Operator:** `operator@izzylease.pl` / `OperatorIzzy2026!`
- **Admin:** `admin@izzylease.pl` / `AdminIzzy2026!`

---

## 📁 Architektura i Pakiety

- `app/` — Full-stack Next.js App Router (strony UI, interfejsy i REST API endpoints)
- `lib/audatex/` — Serwerowe adaptery SOAP:
  - `valuation.ts`: Integracja AudaValuation WS 2023
  - `history.ts`: Integracja Claims History Engine v1.23.0 + dekodery mandatów i 28 stref uszkodzeń
  - `fixtures.ts`: Zanonimizowane próbki XML z oficjalnej dokumentacji Audatex
- `prisma/` — Schemat bazy danych PostgreSQL (Raporty, Wyceny, Szkody, Log Audytowy)
- `Dockerfile` & `docker-compose.yml` — Wdrożenie kontenerowe

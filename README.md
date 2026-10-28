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

**Doładowanie ręczne:** admin może zasilić saldo organizacji w panelu (Organizacje → Kredyty). Faktury za zakupy online wystawia Fakturownia (zob. „Faktury (Fakturownia)” poniżej).

### Zakup online (PayU)

- **Kto kupuje:** każdy użytkownik organizacji w trybie Prepaid (rola bez znaczenia). Organizacje „Bez limitu” i konta bez organizacji nie widzą sklepu.
- **Koszyk i cennik:** sklep na stronie kredytów działa na koszyku (1–20 linii, ilość 1–100 na linię). Pakiety i ceny (netto, VAT liczony na sztukę) zarządza admin w panelu **Cennik kredytów**. Ceny zawsze pochodzą z bazy, nie od klienta.
- **Zmienne środowiskowe:** `PAYU_BASE_URL`, `PAYU_POS_ID`, `PAYU_CLIENT_ID`, `PAYU_CLIENT_SECRET`, `PAYU_SECOND_KEY`, `APP_URL`, opcjonalnie `PAYU_ALLOW_SANDBOX` (zob. `.env.example` i `docker-compose.yml`). Wartości pobierz z panelu PayU (punkt płatności).
- **Adres powiadomień:** w panelu PayU ustaw URL powiadomień na `{APP_URL}/api/payments/payu/notify`.
- **Sandbox vs produkcja:** `PAYU_BASE_URL` nie ma wartości domyślnej w `docker-compose.yml` (brak = płatności wyłączone). Sandbox PayU to `https://secure.snd.payu.com`, produkcja to `https://secure.payu.com` wraz z danymi produkcyjnego punktu płatności. Sandbox w środowisku produkcyjnym (`NODE_ENV=production`) jest odrzucany, bo płatności testowe dodawałyby prawdziwe kredyty. Płatności zostają wtedy wyłączone, dopóki nie ustawisz `PAYU_ALLOW_SANDBOX=true` (tylko do świadomego testu; domyślnie `false`). Zamówienia utworzone na sandboxie mają w bazie `orders.payuSandbox = true`.
- **Brak konfiguracji:** gdy brakuje którejkolwiek zmiennej, płatności online są wyłączone. Sklep pokazuje „Płatności online są chwilowo niedostępne…”, a API zwraca 503.
- **Auto-odbiór:** punkt płatności (POS) w PayU musi mieć włączony automatyczny odbiór płatności (auto-odbiór). Inaczej płatności zostają w statusie `WAITING_FOR_CONFIRMATION` i kredyty nie są dodawane.
- **`APP_URL`:** musi być publicznym adresem https aplikacji.
- **Adres IP klienta:** brany z pierwszego wpisu nagłówka `X-Forwarded-For`, więc Traefik/Cloudflare muszą go ustawiać.
- **Akcje w historii zamówień:** przy zamówieniu „Oczekuje na płatność” przycisk **Sprawdź status** odpytuje PayU o aktualny stan (nie częściej niż raz na 10 s na zamówienie), co pozwala odzyskać zgubione powiadomienie. Po sprawdzeniu twórca zamówienia widzi też link **Dokończ płatność** (adres płatności PayU jest dostępny tylko dla twórcy i tylko dopóki zamówienie czeka na płatność).
- **Produkcja bez PayU do czasu uruchomienia faktur:** na produkcji nie ustawiaj zmiennych PayU, dopóki Fakturownia i zadanie cykliczne nie działają (kolejność w sekcji „Faktury (Fakturownia)”). Bez nich sklep pokazuje „Płatności online są chwilowo niedostępne”, a kredyty doładowuje ręcznie admin.
- **Dane firmy:** zakup wymaga kompletnych danych organizacji (NIP, adres, e-mail do faktur); inaczej API zwraca 409 z prośbą o uzupełnienie.
- **Logi do obserwowania:**
  - `[PAYU_INVALID_SIGNATURE]` — powiadomienie z nieprawidłowym podpisem (loguje tylko `hasHeader`, `algorithm`, `bodyLength`). Sprawdź `PAYU_SECOND_KEY` oraz `APP_URL` i adres powiadomień w panelu PayU.
  - `[PAYU_SANDBOX_IN_PRODUCTION]` — sandbox PayU na produkcji, płatności wyłączone (zob. `PAYU_ALLOW_SANDBOX`).
  - `[PAYU_NOTIFY_ERROR]` — błąd przetwarzania powiadomienia (odpowiedź 500, PayU ponowi próbę).
  - `[PAYU_SYNC_ERROR]` — błąd odpytania PayU o status zamówienia (`Sprawdź status` / strona powrotu).
  - `[PAYU_CREATE_ORDER_ERROR]` — PayU odrzuciło utworzenie zamówienia; zamówienie dostaje status `FAILED`.
  - `[PAYU_PAID_AFTER_CANCEL]` — klient zapłacił po anulowaniu zamówienia (płatność podwójna), sprawdź zwrot środków.
  - `[PAYU_UNKNOWN_ORDER]` — powiadomienie dla nieznanego zamówienia.
  - `[PAYU_AMOUNT_MISMATCH]` — kwota lub waluta z powiadomienia różni się od zamówienia.
  - `[PAYU_SYNC_MISMATCH]` — niezgodność przy synchronizacji statusu z PayU.
- **Faktury:** zob. sekcja „Faktury (Fakturownia)” poniżej.

### Faktury (Fakturownia)

**Zmienne środowiskowe:** `FAKTUROWNIA_DOMAIN` (subdomena konta, bez `.fakturownia.pl`), `FAKTUROWNIA_API_TOKEN`, opcjonalnie `FAKTUROWNIA_DEPARTMENT_ID` (id działu sprzedawcy), `BILLING_CRON_SECRET` (długi losowy ciąg, np. `openssl rand -hex 32`) i opcjonalnie `INVOICE_SANDBOX_ORDERS` (zob. `.env.example` i `docker-compose.yml`). Brak domeny lub tokenu (albo błędna domena / id działu) = Fakturownia jest wyłączona: faktury czekają w statusie „Do wystawienia”, nic się nie psuje, a panel admina pokazuje ostrzeżenie. Po skonfigurowaniu wystawi je następny przebieg zadania cyklicznego.

**Kiedy powstaje faktura:** po tym, jak PayU potwierdzi płatność i kredyty zostaną zaksięgowane. Fakturę wystawia aplikacja zaraz po odpowiedzi na powiadomienie PayU (albo przy wejściu klienta na stronę zamówienia); jeśli się nie uda, zadanie cykliczne ponawia. Zamówienia z sandboxu PayU (`orders.payuSandbox = true`) nie są fakturowane, chyba że ustawisz `INVOICE_SANDBOX_ORDERS=true`. Używaj tego wyłącznie na stagingu, z osobnym kontem Fakturowni (zob. „Kolejność uruchomienia”): nigdy z kontem produkcyjnym ani jego działem. Gdy na produkcji (`NODE_ENV=production`) ustawione są jednocześnie `PAYU_ALLOW_SANDBOX=true` i `INVOICE_SANDBOX_ORDERS=true`, aplikacja loguje `[INVOICE_SANDBOX_IN_PRODUCTION]` i pokazuje czerwone ostrzeżenie w **/admin/orders**.

**Co zawiera faktura:** faktura VAT, oznaczona jako zapłacona, forma płatności PayU, waluta PLN, język polski. Nabywca to organizacja z zamówienia (nazwa, NIP, adres, e-mail do faktur). Pozycje odpowiadają pozycjom zamówienia (jedna pozycja na pakiet: nazwa pakietu, ilość, stawka VAT), a suma brutto jest równa kwocie pobranej od klienta. Numer zamówienia trafia do pola `oid` (Fakturownia odrzuca drugą fakturę z tym samym `oid`, co chroni przed duplikatem). Data sprzedaży i data zapłaty (`paid_date`) to dzień płatności (strefa Europe/Warsaw), a termin płatności jest wyłączony (`payment_to_kind: "off"`), bo faktura jest już zapłacona.

**E-mail i link do PDF:** faktura jest wysyłana z Fakturowni na e-mail do faktur organizacji, a osoba, która złożyła zamówienie, dostaje kopię (gdy jej adres jest inny). Numer faktury i link do PDF widzi klient w historii zamówień, ale dopiero gdy faktura jest wystawiona z linkiem (token) i KSeF jest w dobrym, końcowym stanie (`ok`, `offline`, `not_applicable`, także z przedrostkiem `demo_`) albo faktura została już wysłana e-mailem. Do tego czasu klient widzi tylko „W przygotowaniu” (błędy są widoczne wyłącznie dla admina). Faktura oznaczona ręcznie nie ma linku: klient widzi sam jej numer.

**KSeF:** w ustawieniach konta Fakturowni włącz automatyczne wysyłanie faktur do KSeF. Fakturownia wysyła e-mail dopiero po nadaniu numeru KSeF, więc pierwsza próba zaraz po wystawieniu może się nie udać (log `[INVOICE_EMAIL_ERROR]`) i jest to normalne: zadanie cykliczne ponawia wysyłkę nie częściej niż co 15 minut, przez 3 dni od wystawienia. Odmowa wysyłki e-maila z powodu braku numeru KSeF (odpowiedź 200 ze statusem `error` wspominającym KSeF) jest oczekiwana: nie zapisuje się jej jako błąd faktury, tylko loguje na poziomie info jako `[INVOICE_EMAIL_WAITING_FOR_KSEF]`. Status KSeF jest odpytywany przez 30 dni od wystawienia (do statusu końcowego) i widoczny w panelu **/admin/orders** (przycisk „Odśwież KSeF” wymusza sprawdzenie).

**Problemy KSeF są głośne.** Poprawne statusy to `ok`, `processing`, `offline` i `not_applicable` (oraz ich warianty `demo_`). Każdy inny status (`send_error`, `server_error`, `status_check_error`, `duplicate_error`, `blocked_403_error`, `not_connected`, `offline_error`, dowolny błąd `demo_*`) to problem: przy każdym odświeżeniu, które go widzi, aplikacja loguje `[INVOICE_KSEF_ERROR]` (ze statusem i komunikatami KSeF), a faktura dostaje czerwoną etykietę „Błąd KSeF” w panelu. Brak statusu albo `processing` dłużej niż 6 godzin po wystawieniu to „KSeF: brak potwierdzenia” (log `[INVOICE_KSEF_STALE]`). Statusy problemowe są dalej odpytywane przez 30 dni (poza `duplicate_error`, który jest końcowy, ale nadal jest problemem). W panelu filtr **KSeF: Problemy KSeF** pokazuje tylko takie faktury.

**Ponawianie i statusy w /admin/orders:**
- Nieudane wystawienie ponawiane jest z rosnącym odstępem: 5 minut, potem każdy kolejny dwa razy dłuższy (maks. 24 godziny), do 10 prób. Dopóki są kolejne próby, status to „Błąd (ponowienie)”. Po 10. nieudanej próbie status to „Błąd (tylko ręcznie)”: nie ma już prób automatycznych i trzeba kliknąć **Ponów fakturę** (zeruje licznik prób).
- **„Wymaga sprawdzenia”** (`NEEDS_ATTENTION`) oznacza, że aplikacja nie ma pewności, czy faktura istnieje, i nic nie ponawia sama (żeby nie wystawić drugiej): Fakturownia odpowiedziała, że faktura z tym `oid` już jest, albo faktura powstała, ale nie udało się jej zapisać. Procedura: w Fakturowni wyszukaj fakturę z numerem zamówienia (`oid`, to id zamówienia z panelu admina). Jeśli istnieje, kliknij **Oznacz jako wystawioną ręcznie** i wpisz jej numer. Jeśli nie istnieje, kliknij **Ponów fakturę**. Po „Oznacz jako wystawioną ręcznie” aplikacja nie wysyła tej faktury e-mailem i nie śledzi jej w KSeF: wyślij ją sam z Fakturowni. Klient widzi w historii zamówień sam numer takiej faktury (bez linku do PDF).
- Obie akcje działają tylko, gdy nikt akurat nie wystawia faktury (inaczej panel zwraca konflikt: spróbuj za kilka minut).

**Zadanie cykliczne (Coolify):** dodaj Scheduled Task uruchamiane co 5 minut. Polecenie wykonuje się wewnątrz kontenera aplikacji, a obraz (`node:20-alpine`) nie ma `curl`, więc używamy `wget` i adresu lokalnego (port 3000 z Dockerfile; omija Cloudflare i jego limit 100 s):

```bash
wget -qO- --post-data='' --header="Authorization: Bearer $BILLING_CRON_SECRET" http://127.0.0.1:3000/api/internal/billing-cron
```

Alternatywa bez `wget` (Node 20 ma `fetch`):

```bash
node -e 'fetch("http://127.0.0.1:3000/api/internal/billing-cron",{method:"POST",headers:{authorization:"Bearer "+process.env.BILLING_CRON_SECRET}}).then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})'
```

Po pierwszym przebiegu sprawdź log `[BILLING_CRON]` i panel **/admin/orders** (pole „Ostatni przebieg crona”).

Bez `BILLING_CRON_SECRET` endpoint zwraca 503, z błędnym sekretem 401. Jeden przebieg robi po kolei:
1. odpytuje PayU o zgubione płatności (zamówienia czekające na płatność dłużej niż 15 minut; krok ma własne 15 s budżetu, żeby nie zagłodzić reszty),
2. wystawia i ponawia należne faktury (zamówienie opłacone w kroku 1 jest fakturowane w tym samym przebiegu),
3. odświeża statusy KSeF i ponawia wysyłkę e-mail.

Przebieg ma łączny budżet 45 s: po jego wyczerpaniu nie startuje nowych jednostek pracy, a reszta czeka na następny przebieg. Odpowiedź zawiera same liczniki: `invoicesProcessed`, `ksefRefreshed`, `emailsSent`, `ordersSynced` i `budgetExhausted`. Każdy krok jest pomijany, gdy jego klient (PayU albo Fakturownia) nie jest skonfigurowany. Po każdym przebiegu cron zapisuje „puls” (tabela `job_heartbeats`, nazwa `billing-cron`, liczniki w `lastResultJson`).

**Sygnały dla admina i alerty:** nagłówek **/admin/orders** pokazuje „Wymaga uwagi: N” (suma: faktury „Wymaga sprawdzenia”, „Błąd (tylko ręcznie)” i problemy KSeF; czerwone, gdy N > 0) oraz „Ostatni przebieg crona: X min temu” (czerwone, gdy cron nigdy nie działał albo ostatni przebieg był ponad 15 minut temu). Ustaw w Coolify lub narzędziu do logów alerty na wpisy zawierające `[INVOICE_` i `[BILLING_CRON_ERROR]` oraz zaglądaj do panelu codziennie.

**Logi do obserwowania:**
  - `[INVOICE_ISSUE_ERROR]` — nieudane wystawienie faktury (kod i komunikat, bez danych wrażliwych), albo faktura powstała w Fakturowni, ale nie udało się jej zapisać (w logu `createdInvoiceId` i `createdNumber` do ręcznego uzgodnienia; zamówienie trafia do „Wymaga sprawdzenia”).
  - `[INVOICE_EMAIL_ERROR]` — nieudana wysyłka faktury e-mailem; ponawiana przez 3 dni. Odmowa „brak numeru KSeF” nie jest błędem: to `[INVOICE_EMAIL_WAITING_FOR_KSEF]` (info).
  - `[INVOICE_DUPLICATE_OID]` — Fakturownia ma już fakturę z tym numerem zamówienia; zamówienie trafia do „Wymaga sprawdzenia” (procedura wyżej).
  - `[INVOICE_CLAIM_LOST]` — proces stracił przejęcie zamówienia (np. po przekroczeniu 10 minut przejął je inny proces). Jeśli w logu jest `createdInvoiceId`, w Fakturowni może być faktura nadmiarowa: sprawdź (zamówienie dostaje wtedy notatkę „Wykryto dodatkową fakturę…”).
  - `[INVOICE_KSEF_ERROR]` — błąd odpytania KSeF albo status problemowy KSeF (każdy poza `ok`, `processing`, `offline`, `not_applicable` i wariantami `demo_`), logowany przy każdym odświeżeniu; sprawdź połączenie z KSeF w Fakturowni.
  - `[INVOICE_KSEF_STALE]` — brak statusu KSeF albo `processing` ponad 6 godzin po wystawieniu.
  - `[INVOICE_SANDBOX_IN_PRODUCTION]` — na produkcji włączone jednocześnie `PAYU_ALLOW_SANDBOX` i `INVOICE_SANDBOX_ORDERS`; testowe płatności wystawiałyby prawdziwe faktury.
  - `[BILLING_CRON]` — z obiektem liczników: podsumowanie przebiegu (poziom info); z polem `step` (`payu-sync`, `invoice`, `ksef`): wyjątek w pojedynczym zamówieniu.
  - `[BILLING_CRON_ERROR]` — cały przebieg zadania cyklicznego zakończył się błędem (odpowiedź 500).
  - `[FAKTUROWNIA_CONFIG_INVALID]` — błędna konfiguracja: `FAKTUROWNIA_DOMAIN` nie jest samą subdomeną albo `FAKTUROWNIA_DEPARTMENT_ID` nie jest dodatnią liczbą (w logu tylko nazwa pola). Fakturownia jest wtedy wyłączona.

**Kolejność uruchomienia na produkcji:**
1. Ustaw `FAKTUROWNIA_DOMAIN`, `FAKTUROWNIA_API_TOKEN` (i opcjonalnie `FAKTUROWNIA_DEPARTMENT_ID`) oraz włącz automatyczne wysyłanie do KSeF w ustawieniach konta Fakturowni.
2. Ustaw `BILLING_CRON_SECRET` i dodaj zadanie cykliczne w Coolify (co 5 minut, polecenie `wget` z sekcji „Zadanie cykliczne”). Po pierwszym przebiegu sprawdź log `[BILLING_CRON]` i „Ostatni przebieg crona” w **/admin/orders**.
3. Na stagingu użyj osobnego konta Fakturowni z KSeF w trybie DEMO (albo bez KSeF), nigdy działu konta produkcyjnego: faktura wystawiona w Fakturowni nie znika, a wysłana do prawdziwego KSeF jest dokumentem skarbowym. `INVOICE_SANDBOX_ORDERS=true` ustawiaj tylko razem z tym kontem stagingowym. Sprawdź cały obieg: sandbox PayU, faktura testowa. Zamówienie testowe ma skończyć jako „Wystawiona” z mailem i linkiem do PDF.
4. Przed włączeniem fakturowania na produkcji sprawdź, czy nie ma opłaconych zamówień, które pominięto (zamówienia opłacone przed wdrożeniem mają status faktury „Nie dotyczy”):
   ```sql
   SELECT id FROM orders WHERE status='PAID' AND "payuSandbox"=false AND "invoiceStatus"='NOT_REQUIRED';
   ```
   Jeśli zapytanie zwróci wiersze i mają dostać faktury, uzupełnij je tym samym warunkiem:
   ```sql
   UPDATE orders SET "invoiceStatus"='PENDING', "invoiceNextAttemptAt"=now()
   WHERE status='PAID' AND "payuSandbox"=false AND "invoiceStatus"='NOT_REQUIRED';
   ```
5. Dopiero potem ustaw produkcyjne zmienne PayU.

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

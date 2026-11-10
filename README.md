# Trener – aplikacja dla trenerki personalnej

PWA w Vue 3 + TypeScript + Vite + Pinia + Tailwind 4, backend Supabase (projekt `trener-app`, region Frankfurt).

## Uruchomienie

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
```

Klucze Supabase są w `.env.local` (nie trafia do gita, wzór w `.env.example`).
Port 3000 jest celowy: to domyślny „Site URL” w Supabase Auth, więc magic link działa lokalnie.

## Pierwsze logowanie trenerki

1. Zaloguj się w aplikacji jej adresem e-mail (link z e-maila).
2. Nowe konto dostaje rolę `client`. Nadaj rolę trenerki w Supabase → SQL Editor:

```sql
update public.profiles set role = 'trainer'
where id = (select id from auth.users where email = 'ADRES@TRENERKI');
```

3. Wyloguj i zaloguj ponownie (albo odśwież) – pojawią się przyciski dodawania i edycji.

Rola zmienia się wyłącznie przez SQL: z poziomu API użytkownik może edytować tylko swoje imię.

## Co jest zrobione (Faza 1)

- Logowanie magic linkiem lub hasłem, role `trainer` / `client` / `parent`, RLS.
- Baza ćwiczeń: nazwa PL/EN, partie, sprzęt, wzorzec ruchu, poziom, przeciwwskazania, wskazówki.
- Graf powiązań: regresja / progresja / alternatywa, widok całego łańcucha.
- Wideo z telefonu: nagranie lub galeria → kompresja do 720p w przeglądarce → prywatny bucket `exercise-media`.
- Wyszukiwarka bez polskich znaków, filtry (partia, sprzęt, wzorzec, poziom), ulubione.
- Import ~870 ćwiczeń z free-exercise-db (osobno od własnych, bez duplikatów).
- PWA (instalacja na telefonie), nawigacja dolna, tryb ciemny.

## Co jest zrobione (Faza 2)

- Klienci: grupa (amator / sportowiec / dziecko), cele, ograniczenia, dostępny sprzęt, notatki, archiwum.
- Kreator planu: tygodnie z fazą periodyzacji, treningi (dni), ćwiczenia z seriami / powtórzeniami / ciężarem / tempem / przerwą / RPE.
- Superserie i obwody (litera grupy), przeciąganie ćwiczeń i dni (także między treningami, działa dotykiem).
- Podmiana ćwiczenia na regresję / progresję / alternatywę jednym kliknięciem.
- Ostrzeżenie, gdy przeciwwskazanie ćwiczenia pasuje do ograniczenia klienta (w kreatorze i przy wyborze ćwiczenia).
- Szablony programów; przypisanie klientowi z datą startu tworzy niezależną kopię (`copy_program`), plan klienta można zapisać jako szablon.
- Reguły progresji (+kg lub +powtórzenia na tydzień); „Kopiuj z progresją” tworzy kolejny tydzień jako szkic do przejrzenia.
- Wersja do druku / PDF (`/plany/:id/druk`).
- Klient z kontem widzi tylko swoje plany, i to dopiero gdy nie są szkicem.

## Faza 3 – grafik i rezerwacje (kod gotowy, migracja do zastosowania)

- Grafik tygodnia/dnia, sesje pojedyncze i cykliczne (co tydzień), trening z planu przypisany do sesji.
- Statusy: do akceptacji, potwierdzona, odbyta, nieobecność, odwołana (także cała seria od danej daty).
- Dostępność: szablon tygodnia + wyjątki (dzień wolny / dodatkowe godziny), zasady rezerwacji.
- Klient: wolne terminy (`free_slots`), rezerwacja (`book_slot`), odwołanie w limicie godzin (`cancel_my_session`), lista oczekujących.
- Publiczny formularz `/konsultacja` dla nowych osób + lista zgłoszeń, raport miesięczny.
- Do zrobienia później: przypomnienia push/e-mail/SMS i synchronizacja z Google Calendar (wymagają kluczy i serwera powiadomień).

## Faza 4 – sesje na żywo i udostępnianie (kod gotowy, migracja do zastosowania)

- Sesja na żywo (`/sesja/:id`): serie, ciężar, powtórzenia, timer przerw (superserie po ostatnim ćwiczeniu), podmiana na regresję/progresję.
- Praca offline: sesja zapisuje się na telefonie, wysyła po zakończeniu, a bez zasięgu czeka w kolejce.
- Udostępnianie planu linkiem (`/p/:token`) bez konta, z filmikami, PDF i zatwierdzonymi podsumowaniami; dostęp można cofnąć.
- Dashboard klienta: statystyki miesiąca vs poprzedni, wykres 1RM/maks./objętość, rekordy, serie na partię, pomiary i testy.
- Historia z podsumowaniami po sesji (szkic → akceptacja trenerki → widoczne dla klienta).
- Zbiorczy widok klientów (postęp / bez zmian / dawno nie był) i raport tygodnia na Starcie.
- Do zrobienia z fazą 5: dyktowanie i podsumowania pisane przez AI (Claude przez Edge Function), wysyłka raportu e-mailem/push.

## Faza 5 – analiza ruchu (MediaPipe na telefonie)

- `/analiza`: heatmapa „wzorce vs klienci” (kolor = odchylenie od wzorca, niebieski mniej / czerwony więcej,
  przerywana ramka = pomiaru nie da się zrobić z tego ujęcia) i ostatnie nagrania z flagami.
- `/analiza/nowa`: **kamera na żywo** (szkielet nakładany na obraz w czasie rzeczywistym, licznik powtórzeń i kąt,
  odliczanie 3 s, przełącznik obrazu – same kreski i kropki) albo film z aparatu / galerii. MediaPipe Pose (0.10.21,
  model *full*) działa na urządzeniu: szkielet 17 punktów, powtórzenia, ujęcie (przód / bok / pod kątem) osobno dla
  każdego powtórzenia, pomiary, flagi.
- Zapis: domyślnie tylko szkielet (binarnie + gzip, ok. 220 KB na minutę – ponad 50× mniej niż wideo). Wideo wyłącznie
  po zaznaczeniu „Zachowaj też wideo” (prywatny bucket `analysis-videos`, usuwane po 90 dniach przy otwarciu listy).
- `/analiza/:id`: odtwarzacz ze szkieletem (krok o klatkę, 0,25×–1×, oś z powtórzeniami, wyłączanie obrazu,
  rysowanie: pisak, linia, kąt – rysunki zostają podczas odtwarzania),
  poprawka liczby powtórzeń, porównanie ze wzorcem lub wcześniejszym nagraniem (uśredniona sylwetka z torem,
  tempo faz, heatmapa powtórzeń, tabela pomiarów).
- `/analiza/progi`: progi flagowania do kalibracji i dokładność licznika (cel: < 1 błąd na 20 powtórzeń).
- Zakładka „Ruch” u klienta: nagrania po kolei na tle wzorca.
- Ćwiczenia: przysiad (kolano/biodro w dole, pochylenie, rozstaw kolan, asymetria, biodra w bok, tempo);
  martwy ciąg i pompka w wersji beta.
- Logika w `src/lib/pose/` (czysty TS); test na syntetycznych danych: `npm run test:pose`.
- Do zrobienia: kalibracja na 20–30 prawdziwych nagraniach, generator planów i asystent AI (klucz Anthropic).

## Faza 5 – AI (Claude, Edge Function `ai`)

- **Generator planu** (`/plany/ai`, przycisk „Generator” w Planach) ma dwa tryby:
  - **Z reguł** – zawsze, za darmo, w kilka sekund na telefonie (`src/lib/planRules.ts`): podział wg liczby treningów
    (FBW / góra–dół / push–pull–nogi), sloty wzorców ruchu z kontrolą głównej grupy mięśni, dawki wg celu i poziomu
    (dzieci zawsze ogólnorozwojowo), ćwiczenia najczęściej używane w planach trenerki, progresja serii i RPE, deload.
  - **Z AI** – gdy w sekretach jest `ANTHROPIC_API_KEY`: cel, poziom, liczba treningów i tygodni, sprzęt, ograniczenia → Claude
  układa szkic wyłącznie z ćwiczeń z bazy (przefiltrowanych pod sprzęt i przeciwwskazania; krótkie kody, walidacja po
  stronie serwera) → plan zapisuje się jako **szkic** i otwiera w kreatorze. Do AI nie trafia imię ani kontakt klienta.
- **Asystent** (`/asystent`, kafelek na Starcie): pytania w języku naturalnym; zamknięta lista narzędzi tylko do odczytu
  (klienci, karta, historia ćwiczenia, rekordy, frekwencja, ograniczenia), wykonywanych uprawnieniami trenerki (RLS);
  odpowiedź z linkami do karty klienta.
- Model `claude-opus-5-5` z zapasowym modelem po odmowie (`fallbacks: "default"`). Wymaga sekretu `ANTHROPIC_API_KEY`
  w Supabase → Edge Functions → Secrets.

## Faza 6 – sportowcy i dzieci

- **Sportowcy** (zakładka „Sport” na karcie klienta z grupy Sportowiec): ankieta gotowości 1–5 (sen, zmęczenie, bolesność,
  stres, nastrój) – z trenerką na starcie sesji albo sam pod linkiem  bez konta; światło zielone / żółte /
  czerwone, także względem własnej normy z 28 dni. Panel „Sportowcy – gotowość dziś” na Starcie.
- **Obciążenie**: RPE całej sesji (0–10) i czas przy „Zakończ sesję” → obciążenie sRPE × min, ACWR (EWMA 7/28 dni)
  z ostrzeżeniem > 1,3 / > 1,5 i < 0,8. Brakujące RPE uzupełnia się na karcie.
- **Dzieci** (zakładka „Rozwój”): bateria testów co kwartał (skok w dal, 20 m, 4×10 m, równowaga, brzuszki 30 s, skłon)
  z wykresem rozwoju, przypomnienie na Starcie, odznaki liczone z danych, zgody rodzica (kto i kiedy, wycofanie).
- **Wyzwania drużynowe** (): wspólny cel grupy, wkład każdego dziecka, bez rankingów.
- **Raport dla rodzica** (, bez konta): rodzic sam wyraża zgody; wyniki widać dopiero po zgodzie na udostępnianie.
  Testy, frekwencja, odznaki, wyzwania, zatwierdzone podsumowania; zapis do PDF.
- Metronom tempa (Start i przy ćwiczeniu w sesji): słupki faz, pełny ekran z jednym słupkiem.
- Nie zrobione z planu Fazy 6: pomiar prędkości sztangi z kamery (VBT), zegarki (Garmin / Apple Health),
  liczenie pajacyków z kamery, tryb grupowy na TV.

## Dostęp do bazy dla Claude

Projekt Supabase jest w organizacji **Sztanga**. Połączenie MCP dla tego projektu jest w `.mcp.json` (`supabase-sztanga`) i działa po restarcie sesji w tym folderze (przy pierwszym użyciu logowanie i wybór organizacji Sztanga).

## Baza danych

Migracje w `supabase/migrations/`, wszystkie (001–011) zastosowane na projekcie w chmurze.

Nowe migracje stosuje `npm run db:migrate` (skrypt `scripts/migrate.mjs`, Management API Supabase,
każda migracja w jednej transakcji, historia w `supabase_migrations.schema_migrations`).
Wymaga `SUPABASE_ACCESS_TOKEN` w `.env.local` (token z https://supabase.com/dashboard/account/tokens).
`-- --dry` pokazuje, co poszłoby; `-- --mark <wersja>` oznacza migrację wklejoną ręcznie.
Edge Functions wdraża `npm run fn:deploy -- gcal-sync` (ten sam token, bez Dockera i `supabase login`).

| Tabela | Zawartość |
| --- | --- |
| `profiles` | rola i imię użytkownika (tworzony automatycznie przy rejestracji) |
| `exercises` | baza ćwiczeń |
| `exercise_relations` | `progression` (from → trudniejsze to) i `alternative`; regresja = progresja czytana odwrotnie |
| `exercise_favorites` | ulubione per użytkownik |
| `clients` | klienci (konto opcjonalne – `user_id`) |
| `programs` | szablony (`is_template`) i plany klientów, status szkic / aktywny / zakończony |
| `program_weeks` → `workouts` → `workout_exercises` | tygodnie z fazą, treningi, ćwiczenia z dawką i regułą progresji |
| storage `exercise-media` | wideo ćwiczeń (prywatny, odczyt przez podpisane linki) |

## Do zrobienia

Z Fazy 6: VBT z kamery, zegarki, wyzwania liczone kamerą, tryb grupowy na TV. Interpretacja testów z platformy skokowej
i dynamometru (czeka na dane sprzętu). Przypomnienia push / e-mail. Publikacja aplikacji Google (tryb testowy = token na 7 dni).

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

## Dostęp do bazy dla Claude

Projekt Supabase jest w organizacji **Sztanga**. Połączenie MCP dla tego projektu jest w `.mcp.json` (`supabase-sztanga`) i działa po restarcie sesji w tym folderze (przy pierwszym użyciu logowanie i wybór organizacji Sztanga).

## Baza danych

Migracje w `supabase/migrations/`. Zastosowane na projekcie w chmurze: 001–003 (Fazy 1–2).
Czekają na zastosowanie: 004 (Faza 3) i 005 (Faza 4).

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

## Do zrobienia w kolejnych fazach

Faza 3 grafik i rezerwacje · Faza 4 sesje na żywo, udostępnianie, dashboard ·
Faza 5 AI i analiza wideo · Faza 6 sportowcy i dzieci. Szczegóły w dokumencie planu projektu.

Otwarte z Fazy 1: CI/CD (deploy na Netlify/Vercel) – do podpięcia po założeniu repo na GitHubie;
polskie nazwy ćwiczeń z importu (przetłumaczone są tylko najczęstsze).

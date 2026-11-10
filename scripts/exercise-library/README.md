# Biblioteka ćwiczeń – jak powstała

Źródła (pobierane do osobnego katalogu, nie do repozytorium):

- free-exercise-db (Unlicense): `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json` → `free.json`
- wger.de (CC-BY-SA / CC0, licencja i autor w każdym wpisie): `https://wger.de/api/v2/exerciseinfo/?limit=200&offset=0…800` → `w0.json … w800.json`,
  filmy: `https://wger.de/api/v2/video/?limit=200` → `videos.json`

Pliki tutaj:

- `spec_new.cjs` – wyselekcjonowane nowe ćwiczenia (nazwa PL, mięsień główny i pomocnicze, sprzęt, wzorzec, poziom, opis PL)
- `spec_staples.cjs` – ręczne poprawki i opisy najważniejszych ćwiczeń
- `spec_map.cjs` – filmy wger → nasze ćwiczenia, łańcuchy progresji i alternatywy
- `build.cjs <katalog danych> <wynik.sql> <filmy.json>` – generuje migrację z danymi (`20261110000016_…`) i listę filmów
- `videos.cjs <filmy.json> <katalog źródeł> <katalog wyników> <ffmpeg>` – pobiera filmy i zmniejsza je do MP4 H.264 480p bez dźwięku

Filmy trafiły do bucketu `exercise-media` (`library/<nazwa>.mp4`), a atrybucja autora i licencji do kolumny `exercises.attribution`.

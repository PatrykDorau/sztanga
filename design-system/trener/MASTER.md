# Trener – system projektowy (MASTER)

Źródło: skill `ui-ux-pro-max`, dane z plików CSV skilla (skrypt wyszukiwania nie działa – brak Pythona na tej maszynie,
więc wiersze odczytano bezpośrednio):

- `products.csv` #35 **Fitness/Gym App** → styl *Vibrant & Block-based + Dark Mode (OLED)*; kluczowe: plany treningowe, śledzenie postępów.
- `colors.csv` #35 **Fitness/Gym App** → primary `#F97316` (tekst na nim `#0F172A`), accent/sukces `#22C55E`, destrukcja `#EF4444`, ciemne tło.
- `ui-reasoning.csv` #35 → typografia „Bold + Motivational”, efekty: animowane pierścienie postępu; unikać statycznego designu.
- `typography.csv` #49 **Sports/Fitness** → nagłówki **Barlow Condensed**, tekst **Barlow**.
- `references/pro-rules.md` → checklista przed oddaniem (touch ≥44 px, kontrast 4.5:1 w obu motywach, safe areas,
  alternatywa dla przeciągania, reduced motion, brak emoji jako ikon).

## Kontekst użycia

Trenerka pracuje na telefonie, na sali, często jedną ręką i w biegu. Klienci (amatorzy, sportowcy, rodzice dzieci)
głównie czytają plan. Priorytet: szybkość, duże cele dotykowe, czytelność z odległości, czytelność w słońcu (motyw jasny)
i w ciemnej sali (motyw ciemny).

## Tokeny kolorów (semantyczne – w komponentach nigdy surowe hexy)

| Token | Jasny | Ciemny | Użycie |
| --- | --- | --- | --- |
| `bg` | `#F6F5F3` | `#0B0D10` | tło aplikacji |
| `surface` | `#FFFFFF` | `#15181D` | karty |
| `surface-2` | `#EFEDEA` | `#1E2229` | wiersze w kartach, pola pomocnicze |
| `fg` | `#16181C` | `#F4F5F7` | tekst główny |
| `muted` | `#57534E` | `#A7AFBC` | tekst drugorzędny (≥4.5:1 w obu) |
| `subtle` | `#78716C` | `#7D8694` | ikony dekoracyjne, uchwyty |
| `line` | `#E2DFDA` | `#2A2F37` | obramowania |
| `line-strong` | `#CFCAC3` | `#3A404A` | obramowania pól i przycisków |
| `primary` | `#F97316` | `#F97316` | główne akcje (tło) |
| `on-primary` | `#0F172A` | `#0F172A` | tekst na primary (kontrast ~7:1) |
| `primary-fg` | `#C2410C` | `#FB923C` | primary jako tekst/ikona |
| `primary-soft` | `#FFEDD5` | `#3A1F0E` | zaznaczenia, tła akcentów |
| `success` | `#15803D` | `#22C55E` | postęp, rekordy |
| `warn-*` | amber | amber | ostrzeżenia (przeciwwskazania) |
| `danger` | `#B91C1C` | `#F87171` | usuwanie, błędy |

## Typografia

- Nagłówki: Barlow Condensed 600–700, tytuły ekranów 28–32 px, sekcje 18–20 px.
- Tekst: Barlow 400–600, bazowo 16 px, line-height 1.5; drobny tekst min. 12 px.
- Liczby w dawkach (serie × powtórzenia, kg): `tabular-nums`.

## Komponenty i zasady

- Cel dotykowy min. 44 × 44 px; przycisk główny 48 px.
- Feedback naciśnięcia 100–150 ms przez jasność/tło (bez zmiany rozmiaru elementu).
- Widoczny `focus-visible` (pierścień `primary`).
- Dolna nawigacja: max 5 pozycji (Start, Grafik, Klienci, Plany, Ćwiczenia); profil w nagłówku Startu.
- Nagłówki sticky respektują `safe-area-inset-top`; dolny pasek – `safe-area-inset-bottom`.
- Przeciąganie zawsze ma alternatywę przyciskami (w górę / w dół).
- Ostrzeżenia nie tylko kolorem: ikona + tekst.
- Animacje 150–250 ms, `prefers-reduced-motion` wyłącza animacje.
- Ikony: jeden zestaw liniowy (styl Lucide), obrys 2 px, rozmiary 16/20/24.

## Anty-wzorce

Emoji jako ikony · szary tekst na szarym · statyczny, „urzędowy” wygląd · ukryte akcje tylko pod gestem ·
pomarańczowy tekst na białym (za mały kontrast – używać `primary-fg`).

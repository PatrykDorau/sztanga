-- Opisy ćwiczeń rozciągających: „pomocniczo pracują” → „rozciągają się też” (przy rozciąganiu mięśnie nie pracują).
update public.exercises
set description = replace(description, ' Pomocniczo pracują: ', ' Rozciągają się też: ')
where description like 'Ćwiczenie rozciągające%';

-- Wzorce ruchu dla nowych ćwiczeń trenerki tam, gdzie nazwa nie wystarcza (rozgrzewka i drille bez wzorca).
update public.exercises e set movement_family = v.fam
from (values
  ('Odjeżdżanie na slajderze', 'lunge'),
  ('Wejścia na ścianę z waterbagiem', 'none'),
  ('Bocian z przeskokiem', 'none'),
  ('Niedźwiadek z piłką', 'none'),
  ('Otwieranie biodra w klęku jednonóż', 'none'),
  ('Siłowe 90/90', 'none'),
  ('Pies z głową w dół do deski z unoszeniem nogi', 'none'),
  ('Prostowanie nogi w leżeniu na plecach', 'none'),
  ('Podskoczki na piłce', 'none'),
  ('Skoki przez linię do stabilizacji', 'none'),
  ('Skłon japoński do boku', 'none'),
  ('Open book', 'none'),
  ('Step open book', 'none')
) v(name_pl, fam)
where e.name_pl = v.name_pl and e.source = 'own' and e.movement_family is null;

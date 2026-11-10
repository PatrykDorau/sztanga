/** Normalizacja do wyszukiwania: małe litery, bez polskich znaków ("przysiad" == "PRZYSIĄD"). */
export const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')

/** Każde słowo zapytania musi wystąpić w którymś z pól. */
export function matches(query: string, ...fields: (string | null | undefined)[]) {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fields.map(norm).join(' ')
  return words.every((w) => hay.includes(w))
}

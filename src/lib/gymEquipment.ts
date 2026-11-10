// Co da się zrobić w danej siłowni: kategorie sprzętu i konkretne maszyny wybrane przez trenerkę.
import type { Exercise, Gym } from '@/types'

/** Ćwiczenie możliwe w siłowni? Brak siłowni albo brak ustawień = wszystko dostępne. */
export function availableIn(e: Pick<Exercise, 'id' | 'equipment'>, gym: Pick<Gym, 'equipment' | 'machines'> | null | undefined) {
  if (!gym) return true
  if (gym.equipment && !e.equipment.every((q) => q === 'body only' || gym.equipment!.includes(q))) return false
  if (gym.machines && e.equipment.includes('machine') && !gym.machines.includes(e.id)) return false
  return true
}
export const allowedSet = (all: Exercise[], gym: Pick<Gym, 'equipment' | 'machines'> | null | undefined) =>
  gym && (gym.equipment || gym.machines) ? new Set(all.filter((e) => availableIn(e, gym)).map((e) => e.id)) : null

// Zajęcia grupowe trenerki (siłowy, obwód, core, PZZ, funkcjonalny…): grafik + miesięczne zestawienie dla siłowni.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface GroupClass {
  id: string
  starts_at: string
  ends_at: string
  gym_id: string | null
  kind: string
  participants: number | null
  cancelled: boolean
  notes: string | null
  repeat_id: string | null
}
/** Najczęstsze zajęcia – do szybkiego wyboru (można wpisać własną nazwę). */
export const CLASS_KINDS = ['Trening siłowy', 'Obwód', 'Core', 'PZZ', 'Trening funkcjonalny']

const COLS = 'id, starts_at, ends_at, gym_id, kind, participants, cancelled, notes, repeat_id'
const ok = <T>(r: { data: T; error: unknown }) => {
  if (r.error) throw r.error
  return r.data
}

export const useGroupClassesStore = defineStore('groupClasses', () => {
  const list = ref<GroupClass[]>([])
  const sort = () => list.value.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  function upsert(rows: GroupClass[]) {
    for (const r of rows) {
      const i = list.value.findIndex((x) => x.id === r.id)
      if (i >= 0) list.value[i] = r
      else list.value.push(r)
    }
    sort()
  }

  async function loadRange(from: Date, to: Date) {
    const rows = ok(await supabase.from('group_classes').select(COLS).gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at')) as GroupClass[]
    list.value = list.value.filter((c) => c.starts_at < from.toISOString() || c.starts_at >= to.toISOString())
    upsert(rows)
    return rows
  }

  /** Nowe zajęcia: jedne albo kilka terminów (np. co tydzień – wspólne repeat_id). */
  async function create(input: { gym_id: string | null; kind: string; notes: string | null }, times: { starts_at: string; ends_at: string }[]) {
    const repeat_id = times.length > 1 ? crypto.randomUUID() : null
    const rows = times.map((t) => ({ ...input, ...t, repeat_id }))
    const out = ok(await supabase.from('group_classes').insert(rows).select(COLS)) as GroupClass[]
    upsert(out)
    return out
  }

  async function update(id: string, patch: Partial<Omit<GroupClass, 'id'>>) {
    const row = ok(await supabase.from('group_classes').update(patch).eq('id', id).select(COLS).single()) as GroupClass
    upsert([row])
    return row
  }

  /** Usunięcie zajęć; withFollowing = także kolejne z tej samej serii „co tydzień”. */
  async function remove(c: GroupClass, withFollowing = false) {
    if (withFollowing && c.repeat_id) {
      ok(await supabase.from('group_classes').delete().eq('repeat_id', c.repeat_id).gte('starts_at', c.starts_at))
      list.value = list.value.filter((x) => !(x.repeat_id === c.repeat_id && x.starts_at >= c.starts_at))
    } else {
      ok(await supabase.from('group_classes').delete().eq('id', c.id))
      list.value = list.value.filter((x) => x.id !== c.id)
    }
  }

  return { list, loadRange, create, update, remove }
})

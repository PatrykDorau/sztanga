<script setup lang="ts">
// Badanie: terminy pomiarów, wyniki (wpisywanie albo wklejanie z arkusza), wykres i porównanie terminów.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  addAthletes,
  addSession,
  average,
  deleteStudy,
  entryOf,
  fmt,
  improvement,
  loadStudy,
  matchAthlete,
  parsePaste,
  removeAthlete,
  removeSession,
  saveEntry,
  toCsv,
  updateAthlete,
  updateSession,
  valueOf,
  type StudyAthlete,
  type StudyFull,
} from '@/lib/studies'
import StudyChart from '@/components/StudyChart.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const s = ref<StudyFull | null>(null)
const error = ref('')
const busy = ref(false)
async function reload() {
  s.value = await loadStudy(props.id)
}
onMounted(() => reload().catch((e) => (error.value = (e as Error).message)))
async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

type Tab = 'results' | 'chart' | 'compare'
const tab = ref<Tab>('results')
const day = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: '2-digit' })
const sessionLabel = (id: string) => {
  const se = s.value?.sessions.find((x) => x.id === id)
  return se ? se.label || day(se.day) : ''
}

// ----- Terminy -----
const sessionId = ref<string | null>(null)
watch(s, (v) => {
  if (v && (!sessionId.value || !v.sessions.some((x) => x.id === sessionId.value))) sessionId.value = v.sessions.at(-1)?.id ?? null
})
const session = computed(() => s.value?.sessions.find((x) => x.id === sessionId.value) ?? null)
const newSession = () =>
  run(async () => {
    const se = await addSession(props.id, new Date().toISOString().slice(0, 10), null)
    await reload()
    sessionId.value = se.id
  })
const editSession = ref(false)
const sf = reactive({ day: '', label: '' })
watch(editSession, (v) => v && session.value && Object.assign(sf, { day: session.value.day, label: session.value.label ?? '' }))
const saveSession = () =>
  run(async () => {
    await updateSession(session.value!.id, { day: sf.day, label: sf.label.trim() || null })
    editSession.value = false
    await reload()
  })
const dropSession = () =>
  confirm('Usunąć ten termin razem z wynikami?') &&
  run(async () => {
    await removeSession(session.value!.id)
    editSession.value = false
    await reload()
  })

// ----- Wyniki -----
const draft = reactive<Record<string, string>>({})
const key = (aid: string, t: string) => `${sessionId.value}|${aid}|${t}`
const shown = (a: StudyAthlete, t: string) => draft[key(a.id, t)] ?? fmt(valueOf(s.value!, sessionId.value!, a.id, t), 2).replace('—', '')
async function setVal(a: StudyAthlete, t: string, raw: string) {
  const k = key(a.id, t)
  draft[k] = raw
  const v = raw.trim() === '' ? null : Number(raw.replace(',', '.'))
  if (v != null && !Number.isFinite(v)) return
  const cur = entryOf(s.value!, sessionId.value!, a.id)
  const vals = { ...(cur?.vals ?? {}) }
  if (v == null) delete vals[t]
  else vals[t] = v
  const e = { session_id: sessionId.value!, athlete_id: a.id, vals, excluded: cur?.excluded ?? false, note: cur?.note ?? null }
  await run(() => saveEntry(e))
  if (cur) Object.assign(cur, e)
  else s.value!.entries.push(e)
  delete draft[k]
}
async function toggleExcluded(a: StudyAthlete) {
  const cur = entryOf(s.value!, sessionId.value!, a.id)
  const e = { session_id: sessionId.value!, athlete_id: a.id, vals: cur?.vals ?? {}, excluded: !cur?.excluded, note: cur?.note ?? null }
  await run(() => saveEntry(e))
  if (cur) cur.excluded = e.excluded
  else s.value!.entries.push(e)
}

// ----- Osoby -----
const addingPerson = ref(false)
const pf = reactive({ name: '', position: '' })
const addPerson = () =>
  pf.name.trim() &&
  run(async () => {
    await addAthletes(props.id, [{ name: pf.name.trim(), position: pf.position.trim() || null, client_id: null }], s.value!.athletes.length)
    Object.assign(pf, { name: '', position: '' })
    addingPerson.value = false
    await reload()
  })
const editingAthlete = ref<StudyAthlete | null>(null)
const af = reactive({ name: '', position: '' })
watch(editingAthlete, (a) => a && Object.assign(af, { name: a.name, position: a.position ?? '' }))
const saveAthlete = () =>
  run(async () => {
    await updateAthlete(editingAthlete.value!.id, { name: af.name.trim(), position: af.position.trim() || null })
    editingAthlete.value = null
    await reload()
  })
const dropAthlete = () =>
  confirm(`Usunąć ${editingAthlete.value!.name} z badania (z wynikami)?`) &&
  run(async () => {
    await removeAthlete(editingAthlete.value!.id)
    editingAthlete.value = null
    await reload()
  })

// ----- Wklejanie z arkusza -----
const pasting = ref(false)
const pasteText = ref('')
const preview = computed(() => (s.value ? parsePaste(pasteText.value, s.value.tests) : []))
const doPaste = () =>
  run(async () => {
    const st = s.value!
    const fresh = preview.value.filter((r) => !matchAthlete(st.athletes, r.name))
    if (fresh.length) await addAthletes(props.id, fresh.map((r) => ({ name: r.name, position: r.position, client_id: null })), st.athletes.length)
    await reload()
    for (const r of preview.value) {
      const a = matchAthlete(s.value!.athletes, r.name)
      if (!a) continue
      if (r.position && !a.position) await updateAthlete(a.id, { position: r.position })
      const cur = entryOf(s.value!, sessionId.value!, a.id)
      await saveEntry({ session_id: sessionId.value!, athlete_id: a.id, vals: { ...(cur?.vals ?? {}), ...r.vals }, excluded: cur?.excluded ?? false, note: cur?.note ?? null })
    }
    pasting.value = false
    pasteText.value = ''
    await reload()
  })

// ----- Wykres -----
const chartTest = ref<string | null>(null)
watch(s, (v) => v && !chartTest.value && (chartTest.value = v.tests[0]?.key ?? null))
const chartSessions = computed(() => (s.value?.sessions ?? []).slice(-4))
const chartTestDef = computed(() => s.value?.tests.find((t) => t.key === chartTest.value))
const chartRows = computed(() =>
  (s.value?.athletes ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    sub: a.position,
    values: chartSessions.value.map((se) => valueOf(s.value!, se.id, a.id, chartTest.value ?? '')),
    excluded: chartSessions.value.map((se) => !!entryOf(s.value!, se.id, a.id)?.excluded),
  })),
)
const chartAvg = computed(() => chartSessions.value.map((se) => average(s.value!, se.id, chartTest.value ?? '')))

// ----- Porównanie -----
const cmpA = ref<string | null>(null)
const cmpB = ref<string | null>(null)
watch(s, (v) => {
  if (!v) return
  cmpA.value ??= v.sessions[0]?.id ?? null
  cmpB.value ??= v.sessions.at(-1)?.id ?? null
})
const cmpTest = ref<string | null>(null)
watch(s, (v) => v && !cmpTest.value && (cmpTest.value = v.tests[0]?.key ?? null))
const testDef = computed(() => s.value?.tests.find((t) => t.key === cmpTest.value))
const teamRows = computed(() =>
  (s.value?.tests ?? []).map((t) => {
    const a = cmpA.value ? average(s.value!, cmpA.value, t.key) : null
    const b = cmpB.value ? average(s.value!, cmpB.value, t.key) : null
    return { t, a, b, d: improvement(a, b, t.higher) }
  }),
)
const personRows = computed(() => {
  const t = testDef.value
  if (!t || !s.value) return []
  return s.value.athletes
    .map((a) => {
      const va = cmpA.value ? valueOf(s.value!, cmpA.value, a.id, t.key) : null
      const vb = cmpB.value ? valueOf(s.value!, cmpB.value, a.id, t.key) : null
      return { a, va, vb, d: improvement(va, vb, t.higher) }
    })
    .sort((x, y) => (y.d ?? -1e9) - (x.d ?? -1e9))
})
const positions = computed(() => {
  const t = testDef.value
  if (!t || !s.value || !cmpB.value) return []
  const groups = new Map<string, StudyAthlete[]>()
  for (const a of s.value.athletes) if (a.position) groups.set(a.position, [...(groups.get(a.position) ?? []), a])
  return [...groups.entries()]
    .map(([p, list]) => ({ p, n: list.length, a: cmpA.value ? average(s.value!, cmpA.value, t.key, list) : null, b: average(s.value!, cmpB.value!, t.key, list) }))
    .sort((x, y) => (y.b ?? 0) - (x.b ?? 0))
})
// Wskaźnik wykorzystania fazy ekscentrycznej (CMJ/SJ) – gdy badanie ma oba testy.
const hasEur = computed(() => !!s.value?.tests.some((t) => t.key === 'cmj') && !!s.value?.tests.some((t) => t.key === 'sj'))
const eur = (sid: string | null, aid: string) => {
  if (!sid || !s.value) return null
  const c = valueOf(s.value, sid, aid, 'cmj')
  const j = valueOf(s.value, sid, aid, 'sj')
  return c != null && j ? c / j : null
}
const sign = (d: number | null) => (d == null ? '—' : `${d > 0 ? '+' : ''}${fmt(d, 1)}%`)
const tone = (d: number | null) => (d == null ? 'text-muted' : d >= 1 ? 'text-success' : d <= -1 ? 'text-danger' : 'text-muted')
const arrow = (d: number | null) => (d == null ? '' : d >= 1 ? '▲' : d <= -1 ? '▼' : '•')

// ----- Eksport / usuwanie -----
function exportCsv() {
  const blob = new Blob(['﻿' + toCsv(s.value!)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${s.value!.name}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
const removeStudy = () =>
  confirm(`Usunąć badanie „${s.value!.name}” ze wszystkimi wynikami?`) &&
  run(async () => {
    await deleteStudy(props.id)
    router.replace('/badania')
  })
</script>

<template>
  <main v-if="s" class="pb-10">
    <header class="page-header px-2 pb-2">
      <div class="flex items-center gap-1">
        <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-xl font-bold">{{ s.name }}</h1>
          <p class="truncate text-xs text-muted">{{ [s.team, `${s.athletes.length} os.`, s.tests.map((t) => t.label).join(', ')].filter(Boolean).join(' · ') }}</p>
        </div>
        <button class="icon-btn" aria-label="Pobierz CSV (do arkusza)" title="Pobierz CSV" @click="exportCsv"><Icon name="download" class="size-5" /></button>
      </div>
      <div class="mt-2 grid grid-cols-3 rounded-xl bg-surface-2 p-1 mx-2">
        <button v-for="[k, l] in ([['results', 'Wyniki'], ['chart', 'Wykres'], ['compare', 'Porównanie']] as [Tab, string][])" :key="k" class="min-h-9 rounded-lg text-sm font-semibold" :class="tab === k ? 'bg-surface shadow' : 'text-muted'" @click="tab = k">{{ l }}</button>
      </div>
    </header>

    <div class="space-y-4 px-4 pt-2">
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>

      <!-- ===== Wyniki ===== -->
      <template v-if="tab === 'results'">
        <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Termin">
          <button v-for="se in s.sessions" :key="se.id" role="tab" :aria-selected="se.id === sessionId" class="shrink-0" :class="se.id === sessionId ? 'chip-on' : 'chip-off'" @click="sessionId = se.id">{{ se.label || day(se.day) }}</button>
          <button class="chip-off shrink-0" :disabled="busy" @click="newSession"><Icon name="plus" class="size-4" />Termin</button>
        </div>

        <template v-if="session">
          <div class="flex flex-wrap items-center gap-2">
            <button class="btn-ghost !min-h-9 border border-line-strong text-sm" @click="editSession = !editSession"><Icon name="edit" class="size-4" />Termin</button>
            <button class="btn-ghost !min-h-9 border border-line-strong text-sm" @click="pasting = !pasting"><Icon name="clipboard" class="size-4" />Wklej z arkusza</button>
            <button class="btn-ghost !min-h-9 border border-line-strong text-sm" @click="addingPerson = !addingPerson"><Icon name="plus" class="size-4" />Osoba</button>
          </div>

          <form v-if="editSession" class="card grid grid-cols-2 gap-2 p-3" @submit.prevent="saveSession">
            <label><span class="label">Data</span><input v-model="sf.day" type="date" class="input" /></label>
            <label><span class="label">Nazwa (opcjonalnie)</span><input v-model="sf.label" class="input" placeholder="np. przed sezonem" /></label>
            <button class="btn-primary" :disabled="busy">Zapisz</button>
            <button type="button" class="btn-danger" :disabled="busy" @click="dropSession">Usuń termin</button>
          </form>

          <div v-if="pasting" class="card space-y-2 p-3">
            <p class="text-sm">Wklej wiersze z arkusza: <strong>Nazwisko</strong>, opcjonalnie <strong>pozycja</strong>, potem wyniki w kolejności: {{ s.tests.map((t) => t.label).join(', ') }}. „x” = brak wyniku.</p>
            <textarea v-model="pasteText" rows="5" class="input py-2 font-mono text-xs" placeholder="Betka&#9;Obrona prawa&#9;19,4&#9;12,6" />
            <p v-if="preview.length" class="text-xs text-muted">
              Rozpoznano {{ preview.length }} wierszy · nowe osoby: {{ preview.filter((r) => !matchAthlete(s!.athletes, r.name)).map((r) => r.name).join(', ') || 'brak' }}
            </p>
            <button class="btn-primary w-full" :disabled="busy || !preview.length" @click="doPaste">Zapisz {{ preview.length }} wyników w terminie {{ sessionLabel(session.id) }}</button>
          </div>

          <form v-if="addingPerson" class="card grid grid-cols-2 gap-2 p-3" @submit.prevent="addPerson">
            <label><span class="label">Nazwisko</span><input v-model="pf.name" class="input" /></label>
            <label><span class="label">Pozycja</span><input v-model="pf.position" class="input" placeholder="opcjonalnie" /></label>
            <button class="btn-primary col-span-2" :disabled="busy || !pf.name.trim()">Dodaj osobę</button>
          </form>

          <ul class="space-y-2">
            <li v-for="a in s.athletes" :key="a.id" class="card p-3" :class="entryOf(s, session.id, a.id)?.excluded ? 'opacity-70' : ''">
              <div class="mb-2 flex items-center gap-2">
                <button class="min-w-0 flex-1 text-left" :aria-label="`Edytuj: ${a.name}`" @click="editingAthlete = editingAthlete?.id === a.id ? null : a">
                  <span class="block truncate font-semibold">{{ a.name }}</span>
                  <span v-if="a.position" class="block truncate text-xs text-muted">{{ a.position }}</span>
                </button>
                <label class="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" class="size-4 accent-primary" :checked="!entryOf(s, session.id, a.id)?.excluded" @change="toggleExcluded(a)" />do średniej
                </label>
              </div>
              <form v-if="editingAthlete?.id === a.id" class="mb-2 grid grid-cols-2 gap-2" @submit.prevent="saveAthlete">
                <input v-model="af.name" class="input !min-h-10 text-sm" aria-label="Nazwisko" />
                <input v-model="af.position" class="input !min-h-10 text-sm" aria-label="Pozycja" placeholder="pozycja" />
                <button class="btn-primary !min-h-9 text-sm" :disabled="busy">Zapisz</button>
                <button type="button" class="btn-danger !min-h-9 text-sm" :disabled="busy" @click="dropAthlete">Usuń z badania</button>
              </form>
              <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${Math.min(s.tests.length, 3)}, minmax(0, 1fr))` }">
                <label v-for="t in s.tests" :key="t.key" class="block">
                  <span class="block truncate text-[11px] text-muted">{{ t.label }}{{ t.unit ? ` [${t.unit}]` : '' }}</span>
                  <input class="input !min-h-10 text-center tabular-nums" inputmode="decimal" :value="shown(a, t.key)" :aria-label="`${a.name} – ${t.label}`" @change="setVal(a, t.key, ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
            </li>
          </ul>

          <div class="card p-3">
            <p class="mb-1 text-sm font-bold">Średnia (bez osób wyłączonych)</p>
            <div class="grid gap-2 text-center" :style="{ gridTemplateColumns: `repeat(${Math.min(s.tests.length, 3)}, minmax(0, 1fr))` }">
              <div v-for="t in s.tests" :key="t.key" class="rounded-lg bg-surface-2 p-2">
                <p class="text-[11px] text-muted">{{ t.label }}</p>
                <p class="font-display text-xl font-bold tabular-nums">{{ fmt(average(s, session.id, t.key), 2) }}</p>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- ===== Wykres ===== -->
      <template v-else-if="tab === 'chart'">
        <div class="flex flex-wrap gap-2">
          <button v-for="t in s.tests" :key="t.key" :class="chartTest === t.key ? 'chip-on' : 'chip-off'" @click="chartTest = t.key">{{ t.label }}</button>
        </div>
        <div class="card p-4">
          <p class="mb-3 font-semibold">{{ chartTestDef?.label }}{{ chartTestDef?.unit ? ` [${chartTestDef.unit}]` : '' }}<span v-if="chartTestDef && !chartTestDef.higher" class="ml-1 text-xs font-normal text-muted">(mniej = lepiej)</span></p>
          <StudyChart :rows="chartRows" :series="chartSessions.map((se) => ({ label: se.label || day(se.day) }))" :unit="chartTestDef?.unit ?? ''" :average="chartAvg" />
        </div>
        <p v-if="s.sessions.length > 4" class="text-xs text-muted">Wykres pokazuje 4 ostatnie terminy.</p>
      </template>

      <!-- ===== Porównanie ===== -->
      <template v-else>
        <div v-if="s.sessions.length < 2" class="card p-5 text-center text-sm text-muted">Porównanie pojawi się po dodaniu drugiego terminu (Wyniki → „+ Termin”).</div>
        <template v-else>
          <div class="grid grid-cols-2 gap-2">
            <label><span class="label">Od</span><select v-model="cmpA" class="input"><option v-for="se in s.sessions" :key="se.id" :value="se.id">{{ se.label || day(se.day) }}</option></select></label>
            <label><span class="label">Do</span><select v-model="cmpB" class="input"><option v-for="se in s.sessions" :key="se.id" :value="se.id">{{ se.label || day(se.day) }}</option></select></label>
          </div>

          <section class="card space-y-2 p-4">
            <h2 class="font-bold">{{ s.athletes.length > 1 ? 'Średnio' : 'Wyniki' }}</h2>
            <div v-for="r in teamRows" :key="r.t.key" class="flex items-center gap-2 text-sm">
              <span class="min-w-0 flex-1 truncate">{{ r.t.label }}</span>
              <span class="tabular-nums text-muted">{{ fmt(r.a, 2) }} → <strong class="text-fg">{{ fmt(r.b, 2) }}</strong>{{ r.t.unit ? ` ${r.t.unit}` : '' }}</span>
              <span class="w-16 text-right font-semibold tabular-nums" :class="tone(r.d)">{{ arrow(r.d) }} {{ sign(r.d) }}</span>
            </div>
            <p class="text-xs text-muted">▲ poprawa, ▼ pogorszenie – przy testach „mniej = lepiej” (np. sprint) spadek czasu to poprawa.</p>
          </section>

          <section v-if="s.athletes.length > 1" class="card space-y-2 p-4">
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-bold">Zmiana na osobę</h2>
              <select v-model="cmpTest" class="input !min-h-9 w-auto py-1 text-sm" aria-label="Test">
                <option v-for="t in s.tests" :key="t.key" :value="t.key">{{ t.label }}</option>
              </select>
            </div>
            <ul class="divide-y divide-line text-sm">
              <li v-for="r in personRows" :key="r.a.id" class="flex items-center gap-2 py-1.5">
                <span class="min-w-0 flex-1 truncate">{{ r.a.name }}</span>
                <span class="tabular-nums text-muted">{{ fmt(r.va, 1) }} → {{ fmt(r.vb, 1) }}</span>
                <span class="w-16 text-right font-semibold tabular-nums" :class="tone(r.d)">{{ arrow(r.d) }} {{ sign(r.d) }}</span>
              </li>
            </ul>
          </section>

          <section v-if="positions.length > 1" class="card space-y-2 p-4">
            <h2 class="font-bold">Według pozycji – {{ testDef?.label }}</h2>
            <div v-for="p in positions" :key="p.p" class="flex items-center gap-2 text-sm">
              <span class="min-w-0 flex-1 truncate">{{ p.p }} <span class="text-muted">· {{ p.n }}</span></span>
              <span class="tabular-nums text-muted">{{ fmt(p.a, 1) }} → <strong class="text-fg">{{ fmt(p.b, 1) }}</strong></span>
            </div>
          </section>

          <section v-if="hasEur" class="card space-y-2 p-4">
            <h2 class="font-bold">Wskaźnik CMJ / SJ</h2>
            <p class="text-xs text-muted">Jak bardzo zamach (faza ekscentryczna) poprawia skok. Zwykle 1,0–1,2; bliżej 1,0 = słabsze wykorzystanie odbicia z zamachu.</p>
            <ul class="divide-y divide-line text-sm">
              <li v-for="a in s.athletes" :key="a.id" class="flex items-center gap-2 py-1.5">
                <span class="min-w-0 flex-1 truncate">{{ a.name }}</span>
                <span class="tabular-nums text-muted">{{ fmt(eur(cmpA, a.id), 2) }} → <strong class="text-fg">{{ fmt(eur(cmpB, a.id), 2) }}</strong></span>
              </li>
            </ul>
          </section>
        </template>
      </template>

      <button class="btn-ghost w-full text-sm text-danger" :disabled="busy" @click="removeStudy"><Icon name="trash" class="size-4" />Usuń badanie</button>
    </div>
  </main>
  <main v-else class="px-4 pt-10 text-center text-muted">{{ error || 'Ładowanie…' }}</main>
</template>

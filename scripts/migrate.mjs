// Stosuje brakujące migracje z supabase/migrations na projekcie Supabase przez Management API.
// Nie potrzebuje hasła do bazy ani logowania CLI – wystarczy osobisty token w .env.local:
//   SUPABASE_ACCESS_TOKEN=sbp_...   (https://supabase.com/dashboard/account/tokens)
//
//   npm run db:migrate              – zastosuj brakujące
//   npm run db:migrate -- --dry     – tylko pokaż, co by poszło
//   npm run db:migrate -- --mark 20261110000004,20261110000005
//                                   – oznacz jako zastosowane bez uruchamiania (wklejone ręcznie)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = process.env.SUPABASE_PROJECT_REF ?? readFileSync('supabase/config.toml', 'utf8').match(/project_id\s*=\s*"([^"]+)"/)?.[1]
const args = process.argv.slice(2)
const dry = args.includes('--dry')
const markIdx = args.indexOf('--mark')
const mark = markIdx >= 0 ? (args[markIdx + 1] ?? '').split(',').filter(Boolean) : []

if (!token) {
  console.error('Brak SUPABASE_ACCESS_TOKEN w .env.local – wygeneruj token na https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}
if (!ref) {
  console.error('Brak project_id w supabase/config.toml')
  process.exit(1)
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
  return text ? JSON.parse(text) : []
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

await sql(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`)
const applied = await sql('select version, name from supabase_migrations.schema_migrations')
// Migracje zastosowane przez MCP mają inny numer wersji niż plik, więc porównujemy też po nazwie.
const done = new Set(applied.flatMap((m) => [m.version, m.name]))

const files = readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
let count = 0
for (const f of files) {
  const [, version, name] = f.match(/^(\d+)_(.+)\.sql$/)
  if (done.has(version) || done.has(name)) continue
  const record = `insert into supabase_migrations.schema_migrations (version, name) values (${lit(version)}, ${lit(name)}) on conflict do nothing;`
  if (mark.includes(version)) {
    if (!dry) await sql(record)
    console.log(`✓ oznaczona jako zastosowana: ${f}`)
    continue
  }
  if (dry) {
    console.log(`• do zastosowania: ${f}`)
    continue
  }
  process.stdout.write(`→ ${f} … `)
  try {
    // Całość w jednej transakcji: błąd = nic się nie zmienia.
    await sql(`begin;\n${readFileSync(join(DIR, f), 'utf8')}\n;${record}\ncommit;`)
    console.log('OK')
    count++
  } catch (e) {
    console.log('BŁĄD')
    console.error(e.message)
    process.exit(1)
  }
}
console.log(count ? `Zastosowano migracji: ${count}` : dry ? '' : 'Baza jest aktualna.')

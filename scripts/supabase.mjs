// Uruchamia Supabase CLI z tokenem z .env.local (bez `supabase login`):
//   npm run fn:deploy -- gcal-sync   → wdrożenie Edge Function (bundlowanie po stronie Supabase, bez Dockera)
import { spawnSync } from 'node:child_process'

const bin = process.platform === 'win32' ? 'node_modules\\.bin\\supabase.cmd' : 'node_modules/.bin/supabase'
const r = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(r.status ?? 1)

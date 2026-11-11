// Klucze VAPID do powiadomień push: generuje parę (raz), zapisuje w .env.local i w sekretach funkcji Supabase.
// Prywatny klucz nie jest nigdzie wyświetlany; aplikacja pobiera publiczny z funkcji „notify”.
// Uruchom raz: npm run push:keys
import { generateKeyPairSync } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'

const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = readFileSync('supabase/config.toml', 'utf8').match(/project_id\s*=\s*"([^"]+)"/)?.[1]
if (!token || !ref) throw new Error('Brak SUPABASE_ACCESS_TOKEN w .env.local albo project_id w supabase/config.toml')

let pub = process.env.VAPID_PUBLIC_KEY
let priv = process.env.VAPID_PRIVATE_KEY
if (!pub || !priv) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pj = publicKey.export({ format: 'jwk' })
  const b = (s) => Buffer.from(s, 'base64url')
  pub = Buffer.concat([Buffer.from([4]), b(pj.x), b(pj.y)]).toString('base64url')
  priv = privateKey.export({ format: 'jwk' }).d
  appendFileSync('.env.local', `\nVAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${priv}\n`)
}
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { name: 'VAPID_PUBLIC_KEY', value: pub },
    { name: 'VAPID_PRIVATE_KEY', value: priv },
    { name: 'VAPID_SUBJECT', value: 'mailto:powiadomienia@example.com' },
  ]),
})
if (!res.ok) throw new Error(`Nie udało się zapisać sekretów: ${res.status} ${await res.text()}`)
console.log('Gotowe – klucze powiadomień push zapisane w Supabase.')

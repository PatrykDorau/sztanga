// Generuje ikony PNG aplikacji (instalacja na telefonie) z tych samych kształtów co public/icon.svg.
// Bez zależności: prosta rasteryzacja zaokrąglonych prostokątów z wygładzaniem 4×4 + zapis PNG przez zlib.
// Uruchom: node scripts/make-icons.cjs
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const BG = [0x0b, 0x0d, 0x10]
const FG = [0xf9, 0x73, 0x16]
// [x, y, w, h, r] w układzie 512×512 – jak w icon.svg
const BARS = [
  [92, 212, 44, 88, 12],
  [144, 164, 52, 184, 14],
  [196, 236, 120, 40, 10],
  [316, 164, 52, 184, 14],
  [376, 212, 44, 88, 12],
]

function inRound(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
}

function render(size, { corner, scale = 1 }) {
  const k = 512 / size
  const S = 4
  const buf = Buffer.alloc(size * (size * 4 + 1))
  for (let j = 0; j < size; j++) {
    buf[j * (size * 4 + 1)] = 0
    for (let i = 0; i < size; i++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const px = (i + (sx + 0.5) / S) * k
          const py = (j + (sy + 0.5) / S) * k
          if (!inRound(px, py, 0, 0, 512, 512, corner)) continue
          // zawartość skalowana względem środka (maskable: mieści się w bezpiecznym kole)
          const qx = 256 + (px - 256) / scale
          const qy = 256 + (py - 256) / scale
          if (BARS.some((b) => inRound(qx, qy, ...b))) fg++
          else bg++
        }
      const a = (bg + fg) / (S * S)
      const o = j * (size * 4 + 1) + 1 + i * 4
      for (let c = 0; c < 3; c++) buf[o + c] = bg + fg ? Math.round((BG[c] * bg + FG[c] * fg) / (bg + fg)) : 0
      buf[o + 3] = Math.round(a * 255)
    }
  }
  return png(size, buf)
}

function crc32(b) {
  let c = ~0
  for (const x of b) {
    c ^= x
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = path.join(__dirname, '..', 'public')
const files = {
  'icon-192.png': render(192, { corner: 112 }),
  'icon-512.png': render(512, { corner: 112 }),
  'maskable-512.png': render(512, { corner: 0, scale: 0.9 }),
  'apple-touch-icon.png': render(180, { corner: 0 }),
}
for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(out, n), b)
console.log('Zapisano:', Object.keys(files).join(', '))

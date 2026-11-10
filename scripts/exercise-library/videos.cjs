// Pobiera filmy z wger (lista z build.cjs) i konwertuje do lekkiego MP4 H.264 480p bez dźwięku (maks. 12 s, szybki start).
// Pliki źródłowe w katalogu danych (osobny folder), wynik w katalogu docelowym.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const [list, srcDir, outDir, ffmpeg] = process.argv.slice(2)
const vids = JSON.parse(fs.readFileSync(list, 'utf8'))
fs.mkdirSync(srcDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })
;(async () => {
  for (const v of vids) {
    const out = path.join(outDir, `${v.slug}.mp4`)
    if (fs.existsSync(out)) continue
    const src = path.join(srcDir, `${v.slug}.${v.url.split('.').pop().toLowerCase()}`)
    if (!fs.existsSync(src)) {
      const r = await fetch(v.url)
      if (!r.ok) {
        console.log('BŁĄD pobierania', v.target, r.status)
        continue
      }
      fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()))
    }
    try {
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-t', '12', '-an', '-vf', 'scale=-2:480:flags=bicubic,fps=30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
      console.log('OK', v.target, Math.round(fs.statSync(out).size / 1024), 'KB')
      fs.unlinkSync(src) // oryginał już niepotrzebny
    } catch (e) {
      console.log('BŁĄD konwersji', v.target, String(e.message).slice(0, 200))
    }
  }
})()

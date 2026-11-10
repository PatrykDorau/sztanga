import { ref, watchEffect } from 'vue'

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'theme'

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export const themePref = ref<ThemePref>(read())
const media = window.matchMedia('(prefers-color-scheme: dark)')

function apply() {
  const dark = themePref.value === 'dark' || (themePref.value === 'system' && media.matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0d10' : '#f6f5f3')
}

export function initTheme() {
  media.addEventListener('change', apply)
  watchEffect(() => {
    try {
      localStorage.setItem(KEY, themePref.value)
    } catch {
      /* tryb prywatny */
    }
    apply()
  })
}

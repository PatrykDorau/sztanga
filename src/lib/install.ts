// Instalacja aplikacji na telefonie (PWA). Android/Chrome/Edge: przechwycone zdarzenie beforeinstallprompt
// pokazuje systemowe okno „Zainstaluj”. iPhone (Safari) nie ma takiego zdarzenia – pokazujemy instrukcję
// „Udostępnij → Do ekranu początkowego”.
import { computed, ref } from 'vue'

interface InstallEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = ref<InstallEvent | null>(null)
const installed = ref(false)
const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
export const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

/** Wywołać raz przy starcie – zdarzenie przychodzi zaraz po wczytaniu strony. */
export function initInstall() {
  installed.value = standalone()
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred.value = e as InstallEvent
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferred.value = null
  })
}

/** Czy da się zainstalować jednym przyciskiem (Android/desktop Chrome). */
export const canPrompt = computed(() => !!deferred.value && !installed.value)
/** Czy pokazać instrukcję dla iPhone'a. */
export const showIosHint = computed(() => isIos && !installed.value)
export const isInstalled = computed(() => installed.value)

export async function promptInstall() {
  const e = deferred.value
  if (!e) return false
  await e.prompt()
  const { outcome } = await e.userChoice
  deferred.value = null
  return outcome === 'accepted'
}

const KEY = 'install-banner-hidden'
export function bannerHidden() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
export function hideBanner() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* tryb prywatny – trudno */
  }
}

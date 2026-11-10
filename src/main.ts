import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'
import { initTheme } from './lib/theme'
import { initInstall } from './lib/install'

initTheme()
initInstall()
createApp(App)
  .use(createPinia())
  .use(router)
  // v-focus zamiast autofocus: działa też w elementach pokazywanych później (v-if).
  .directive('focus', { mounted: (el: HTMLElement) => el.focus() })
  .mount('#app')

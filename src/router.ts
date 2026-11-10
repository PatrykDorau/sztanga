import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    { path: '/cwiczenia', name: 'exercises', component: () => import('@/views/ExercisesView.vue') },
    { path: '/cwiczenia/nowe', name: 'exercise-new', component: () => import('@/views/ExerciseFormView.vue'), meta: { trainer: true } },
    { path: '/cwiczenia/import', name: 'exercise-import', component: () => import('@/views/ImportView.vue'), meta: { trainer: true } },
    { path: '/cwiczenia/:id', name: 'exercise', component: () => import('@/views/ExerciseDetailView.vue'), props: true },
    { path: '/cwiczenia/:id/edycja', name: 'exercise-edit', component: () => import('@/views/ExerciseFormView.vue'), props: true, meta: { trainer: true } },
    { path: '/klienci', name: 'clients', component: () => import('@/views/ClientsView.vue'), meta: { trainer: true } },
    { path: '/klienci/nowy', name: 'client-new', component: () => import('@/views/ClientFormView.vue'), meta: { trainer: true } },
    { path: '/klienci/:id', name: 'client', component: () => import('@/views/ClientDetailView.vue'), props: true, meta: { trainer: true } },
    { path: '/klienci/:id/edycja', name: 'client-edit', component: () => import('@/views/ClientFormView.vue'), props: true, meta: { trainer: true } },
    { path: '/plany', name: 'programs', component: () => import('@/views/ProgramsView.vue'), meta: { trainer: true } },
    { path: '/plany/:id', name: 'program', component: () => import('@/views/ProgramEditorView.vue'), props: true, meta: { trainer: true } },
    { path: '/plany/:id/druk', name: 'program-print', component: () => import('@/views/ProgramPrintView.vue'), props: true, meta: { trainer: true, bare: true } },
    { path: '/profil', name: 'profile', component: () => import('@/views/ProfileView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  if (to.meta.public) return auth.session && to.name === 'login' ? { name: 'home' } : true
  if (!auth.session) return { name: 'login', query: { next: to.fullPath } }
  if (to.meta.trainer && !auth.isTrainer) return { name: 'home' }
  return true
})

export default router

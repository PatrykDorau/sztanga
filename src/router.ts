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
    { path: '/plany/ai', name: 'program-ai', component: () => import('@/views/AiPlanView.vue'), meta: { trainer: true } },
    { path: '/asystent', name: 'assistant', component: () => import('@/views/AssistantView.vue'), meta: { trainer: true } },
    { path: '/plany/:id', name: 'program', component: () => import('@/views/ProgramEditorView.vue'), props: true, meta: { trainer: true } },
    { path: '/plany/:id/druk', name: 'program-print', component: () => import('@/views/ProgramPrintView.vue'), props: true, meta: { bare: true } }, // klient też: RLS pokazuje mu tylko jego nie-szkicowe plany
    { path: '/grafik', name: 'schedule', component: () => import('@/views/ScheduleView.vue'), meta: { trainer: true } },
    { path: '/grafik/dostepnosc', name: 'availability', component: () => import('@/views/AvailabilityView.vue'), meta: { trainer: true } },
    { path: '/grafik/zgloszenia', name: 'requests', component: () => import('@/views/RequestsView.vue'), meta: { trainer: true } },
    { path: '/grafik/google', name: 'google', component: () => import('@/views/GoogleCalendarView.vue'), meta: { trainer: true } },
    { path: '/grafik/raport', name: 'report', component: () => import('@/views/ReportView.vue'), meta: { trainer: true } },
    { path: '/analiza', name: 'analysis', component: () => import('@/views/AnalysisHomeView.vue'), meta: { trainer: true } },
    { path: '/analiza/nowa', name: 'analysis-new', component: () => import('@/views/AnalysisNewView.vue'), meta: { trainer: true } },
    { path: '/analiza/progi', name: 'analysis-settings', component: () => import('@/views/AnalysisSettingsView.vue'), meta: { trainer: true } },
    { path: '/analiza/:id', name: 'analysis-view', component: () => import('@/views/AnalysisView.vue'), props: true, meta: { trainer: true } },
    { path: '/sesja/:id', name: 'live', component: () => import('@/views/LiveSessionView.vue'), props: true, meta: { trainer: true, bare: true } },
    // Plan pod linkiem – bez logowania, dane tylko przez funkcję get_shared_plan(token).
    { path: '/g/:token', name: 'readiness-link', component: () => import('@/views/ReadinessLinkView.vue'), props: true, meta: { public: true, bare: true } },
    { path: '/t/:token', name: 'reschedule-link', component: () => import('@/views/RescheduleLinkView.vue'), props: true, meta: { public: true, bare: true } },
    { path: '/r/:token', name: 'parent-report', component: () => import('@/views/ParentReportView.vue'), props: true, meta: { public: true, bare: true } },
    { path: '/wyzwania', name: 'challenges', component: () => import('@/views/ChallengesView.vue'), meta: { trainer: true } },
    { path: '/p/:token', name: 'shared-plan', component: () => import('@/views/SharedPlanView.vue'), props: true, meta: { public: true } },
    { path: '/terminy', name: 'my-sessions', component: () => import('@/views/MySessionsView.vue') },
    // Publiczny formularz dla nowych klientów – bez logowania.
    { path: '/konsultacja', name: 'consultation', component: () => import('@/views/ConsultationView.vue'), meta: { public: true } },
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
  if (to.name === 'my-sessions' && auth.isTrainer) return { name: 'schedule' }
  return true
})

export default router

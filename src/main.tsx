/**
 * AI module map
 * Purpose: bootstrap the trusted React UI and register commerce routes.
 * Entry: index.html loads this module and supplies #root.
 * Flow: create the router, select hash history only in Tauri, and mount ThemeProvider,
 * LicenseGate, RouterProvider, and the global Toaster under StrictMode.
 * Route modules load on entry so activation and other routes do not load dashboard charts.
 * The invitation route uses a platform search parameter for separate sidebar entries
 * and dashboard account navigation; platform account/task ownership remains in the store.
 * Invariants: licensing gates business initialization; browser preview remains separate.
 * AppShell owns persistent native-view hosts, so routing must not recreate runtime jobs.
 * Hot replacement unmounts this entry's React root before another root is created.
 */

import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  lazyRouteComponent,
  RouterProvider,
} from '@tanstack/react-router'
import { ThemeProvider } from '@/context/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { LoadingState } from '@/components/ui/loading-state'
import { desktop } from '@/features/commerce/desktop'
import { LicenseGate } from '@/features/commerce/license'
import { AppShell } from '@/features/commerce/shell'
import type { Platform } from '@/features/commerce/types'
import './styles/index.css'

const root = createRootRoute({ component: AppShell })
const routes = [
  createRoute({
    getParentRoute: () => root,
    path: '/',
    component: lazyRouteComponent(() => import('@/features/commerce/dashboard'), 'Dashboard'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/invites',
    validateSearch: (search: Record<string, unknown>): { platform?: Platform } => ({
      platform: search.platform === 'douyin' ? 'douyin' : 'kuaishou',
    }),
    component: lazyRouteComponent(() => import('@/features/commerce/invites'), 'InvitePage'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/workbench',
    component: lazyRouteComponent(() => import('@/features/commerce/workbench'), 'WorkbenchPage'),
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/tutorial',
    component: lazyRouteComponent(() => import('@/features/commerce/tutorial'), 'TutorialPage'),
  }),
]
const router = createRouter({
  routeTree: root.addChildren(routes),
  defaultPendingComponent: () => <LoadingState label='正在加载页面…' className='h-svh' />,
  defaultPendingMinMs: 0,
  ...(desktop ? { history: createHashHistory() } : {}),
})
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
const reactRoot = ReactDOM.createRoot(document.getElementById('root')!)
reactRoot.render(
  <StrictMode>
    <ThemeProvider defaultTheme='light'>
      <LicenseGate>
        <RouterProvider router={router} />
      </LicenseGate>
      <Toaster position='bottom-center' />
    </ThemeProvider>
  </StrictMode>
)
if (import.meta.hot) import.meta.hot.dispose(() => reactRoot.unmount())

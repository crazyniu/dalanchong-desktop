import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { ThemeProvider } from '@/context/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { AccountsPage } from '@/features/commerce/accounts'
import { Dashboard } from '@/features/commerce/dashboard'
import { desktop } from '@/features/commerce/desktop'
import { InvitePage } from '@/features/commerce/invites'
import { LicenseGate } from '@/features/commerce/license'
import { AppShell } from '@/features/commerce/shell'
import './styles/index.css'

const root = createRootRoute({ component: AppShell })
const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: Dashboard }),
  createRoute({
    getParentRoute: () => root,
    path: '/kuaishou',
    component: () => <InvitePage platform='kuaishou' />,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/douyin',
    component: () => <InvitePage platform='douyin' />,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/accounts',
    component: AccountsPage,
  }),
]
const router = createRouter({
  routeTree: root.addChildren(routes),
  ...(desktop ? { history: createHashHistory() } : {}),
})
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme='light'>
      <LicenseGate>
        <RouterProvider router={router} />
      </LicenseGate>
      <Toaster position='bottom-center' />
    </ThemeProvider>
  </StrictMode>
)

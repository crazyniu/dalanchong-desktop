/**
 * AI module map
 * Purpose: compose persistent navigation and global native-view hosts around route content.
 * Entry: AppShell is the TanStack root route used by main.tsx.
 * Flow: the fixed sidebar links the dashboard, browser accounts, and separate platform
 * invitation entries, Mac-only video montage, and the tutorial;
 * invitation links and active states include the platform query. Native platform
 * discovery controls montage visibility, independently of license permission checks.
 * Title/version appear at top, license expiry at bottom, and Outlet renders commerce.
 * BrowserLayer lives outside individual pages to retain invitation sessions and global
 * progress for all running invitation tasks across both platforms and covering dialogs.
 * OnboardingGuide owns the first-use walkthrough and tutorial-triggered replay.
 * Invariant: changing a route must not recreate authoritative task state or collapse
 * the sidebar; native view visibility is coordinated by browser.tsx.
 */

import { Link, Outlet, useLocation, useMatch } from '@tanstack/react-router'
import { BookOpen, Clapperboard, LayoutDashboard, Music2, Store, Video } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarGroup,
} from '@/components/ui/sidebar'
import { BrowserLayer } from './browser'
import { desktop } from './desktop'
import { LicenseStatus } from './license'
import { OnboardingGuide } from './onboarding'
import { UpdateStatus } from './update'
import { useMacVideoMontage } from '@/features/video-montage/platform'

const navigation = [
  { title: '数据概览', to: '/' as const, icon: LayoutDashboard },
  { title: '多店铺管理', to: '/workbench' as const, icon: Store },
  { title: '抖音达人邀约', to: '/invites' as const, platform: 'douyin' as const, icon: Music2 },
  { title: '快手达人邀约', to: '/invites' as const, platform: 'kuaishou' as const, icon: Video },
  { title: '视频混剪', to: '/video-montage' as const, icon: Clapperboard, macOnly: true },
  { title: '使用教程', to: '/tutorial' as const, icon: BookOpen },
]

export function AppShell() {
  const macVideoMontage = useMacVideoMontage()
  const pathname = useLocation({ select: (l) => l.pathname })
  const inviteMatch = useMatch({ from: '/invites', shouldThrow: false })
  const platform = inviteMatch?.search.platform ?? 'kuaishou'

  return (
    <SidebarProvider
      open
      style={{ '--sidebar-width': '220px' } as React.CSSProperties}
    >
      <Sidebar
        collapsible='none'
        className='sticky top-0 h-svh shrink-0 border-r border-border/80'
      >
        <SidebarHeader className='h-24 justify-center px-4'>
          <div className='flex items-center gap-3 px-2 py-2'>
            <img
              src='./brand-transparent.png'
              alt=''
              className='size-12 object-contain'
            />
            <div className='min-w-0 flex-1'>
              <span className='block text-xl font-semibold tracking-tight'>
                大懒虫
              </span>
              <UpdateStatus />
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className='px-3 pt-4'>
            <SidebarMenu className='gap-2'>
              {navigation.filter((item) => !('macOnly' in item) || macVideoMontage).map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.to && (!item.platform || platform === item.platform)}
                    className='h-11 rounded-lg px-3 text-sm data-[active=true]:font-semibold'
                  >
                    <Link to={item.to} search={item.platform ? { platform: item.platform } : undefined}>
                      <item.icon className='mr-1 size-[18px]' strokeWidth={1.7} />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className='shrink-0 gap-2 p-4'>
          {!desktop && (
            <Badge variant='outline' className='font-normal'>
              演示数据
            </Badge>
          )}
          <LicenseStatus />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className='min-w-0'>
        <Outlet />
      </SidebarInset>
      <BrowserLayer />
      <OnboardingGuide />
    </SidebarProvider>
  )
}

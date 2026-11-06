import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { LayoutDashboard, Video, Music2, UsersRound } from 'lucide-react'
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
import { UpdateStatus } from './update'

const navigation = [
  { title: '数据概览', to: '/' as const, icon: LayoutDashboard },
  { title: '快手邀约', to: '/kuaishou' as const, icon: Video },
  { title: '抖音邀约', to: '/douyin' as const, icon: Music2 },
  { title: '平台账号', to: '/accounts' as const, icon: UsersRound },
]
export function AppShell() {
  const pathname = useLocation({ select: (l) => l.pathname })
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
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size='lg'
                className='h-auto hover:bg-transparent'
              >
                <Link to='/' className='gap-3'>
                  <img
                    src='./brand-transparent.png'
                    alt=''
                    className='size-12 object-contain'
                  />
                  <span className='text-xl font-semibold tracking-tight'>
                    大懒虫
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className='px-3 pt-4'>
            <SidebarMenu className='gap-2'>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    isActive={pathname === item.to}
                    className='h-11 rounded-lg px-3 text-sm data-[active=true]:font-semibold'
                  >
                    <Link to={item.to}>
                      <item.icon
                        className='mr-1 size-[18px]'
                        strokeWidth={1.7}
                      />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className='items-center p-4'>
          {!desktop && (
            <Badge variant='outline' className='font-normal'>
              演示数据
            </Badge>
          )}
          <LicenseStatus />
          <UpdateStatus />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className='min-w-0'>
        <Outlet />
      </SidebarInset>
      <BrowserLayer />
    </SidebarProvider>
  )
}

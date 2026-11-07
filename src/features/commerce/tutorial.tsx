/**
 * AI module map
 * Purpose: provide the persistent, readable tutorial and an explicit onboarding replay.
 * Entry: TutorialPage is mounted by the application's tutorial route.
 * Flow: render shared guideSteps, optional collection-page/help details, and user-clicked
 * route links. startOnboarding owns modal coordination and replay state.
 * State: Radix collapsibles own only their open state. Reading or expanding this page
 * never creates accounts, changes configuration, or starts collection/invitation jobs.
 * Invariants: match the existing commerce flow and collection-pages.mjs allowlist;
 * keep instructions separate from account data, credentials, and task execution.
 */

import { Link } from '@tanstack/react-router'
import { ArrowUpRight, ChevronDown, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { startOnboarding } from './onboarding'
import { guideSteps } from './tutorial-content'

const questions = [
  {
    title: '为什么选了达人，却提示没有无邀约记录的达人？',
    answer: '当前账号只邀约没有邀约记录的达人。成功、跳过、失败、待核实和发送中都属于已有记录，不受日期限制；筛掉的达人不计入本次人数。',
  },
  {
    title: '快手显示“风控，等待后重试”怎么办？',
    answer: '返回 400010 时会等待 5 秒后重试当前达人，若设置了更长的邀约间隔，则按更长间隔等待。期间可点击“停止”。其他结果不明确的请求会停止并标为待核实。',
  },
  {
    title: '任务进行时能操作网页吗？',
    answer: '采集期间网页有遮罩，结束或停止后恢复。邀约期间网页可操作，切换账号或关闭弹框不会停止邀约；需要结束任务请使用“停止”。',
  },
] as const

export function TutorialPage() {
  return (
    <main className='flex h-svh min-h-0 min-w-0 flex-col bg-muted/30'>
      <div className='workspace-toolbar shrink-0'>
        <div className='page-toolbar flex-wrap'>
          <h1 className='text-2xl font-semibold'>使用教程</h1>
          <Button className='ml-auto' variant='outline' onClick={() => void startOnboarding()}>
            <RotateCcw />
            重播新手引导
          </Button>
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-6'>
        <div className='max-w-6xl space-y-5'>
          <section aria-label='使用步骤' className='grid gap-4 lg:grid-cols-2'>
            {guideSteps.map((step, index) => (
              <Card key={step.id} className='gap-4 py-5 shadow-none'>
                <CardHeader className='px-5'>
                  <CardTitle>
                    <h2 className='flex items-center gap-2 text-base leading-6'>
                      <span aria-hidden='true'>{step.emoji}</span>
                      {index + 1}. {step.title}
                    </h2>
                  </CardTitle>
                  <p className='text-sm text-muted-foreground'>{step.location}</p>
                </CardHeader>
                <CardContent className='px-5'>
                  <ol className='list-decimal space-y-2 pl-5 text-sm leading-6 marker:text-muted-foreground'>
                    {step.steps.map((instruction) => <li key={instruction}>{instruction}</li>)}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </section>

          <nav aria-label='操作入口' className='flex flex-wrap gap-2'>
            <Button asChild variant='outline'>
              <Link to='/invites' search={{ platform: 'douyin' }}>
                抖音达人邀约<ArrowUpRight />
              </Link>
            </Button>
            <Button asChild variant='outline'>
              <Link to='/invites' search={{ platform: 'kuaishou' }}>
                快手达人邀约<ArrowUpRight />
              </Link>
            </Button>
            <Button asChild variant='outline'>
              <Link to='/workbench'>多店铺<ArrowUpRight /></Link>
            </Button>
          </nav>

          <Card className='gap-3 py-5 shadow-none'>
            <CardHeader className='px-5'>
              <CardTitle>
                <h2 className='text-base leading-6'><span aria-hidden='true'>💡 </span>常见问题</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className='divide-y px-5'>
              <Collapsible>
                <CollapsibleTrigger className='group flex w-full items-center justify-between gap-4 py-3 text-left text-sm font-medium'>
                  哪些页面支持采集？
                  <ChevronDown className='size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180' />
                </CollapsibleTrigger>
                <CollapsibleContent className='space-y-2 pb-4 text-sm leading-6 text-muted-foreground'>
                  <p><span className='font-medium text-foreground'>快手：</span>达人广场、同行合作参考、达人排行榜。</p>
                  <p><span className='font-medium text-foreground'>抖音：</span>达人广场、同行合作参考、意向带货达人、达人排行榜。</p>
                  <p>进入对应页面并设置筛选，等网页显示达人后再开始采集。</p>
                </CollapsibleContent>
              </Collapsible>
              {questions.map((question) => (
                <Collapsible key={question.title}>
                  <CollapsibleTrigger className='group flex w-full items-center justify-between gap-4 py-3 text-left text-sm font-medium'>
                    {question.title}
                    <ChevronDown className='size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180' />
                  </CollapsibleTrigger>
                  <CollapsibleContent className='pb-4 text-sm leading-6 text-muted-foreground'>
                    {question.answer}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}

/**
 * AI module map
 * Purpose: present the replayable first-use walkthrough without performing business actions.
 * Entry: AppShell mounts OnboardingGuide; TutorialPage calls startOnboarding to replay.
 * Flow: wait for running tasks to finish before first automatic display, then use the
 * existing native-dialog transaction before mounting the shared Shadcn Dialog.
 * State: Zustand owns the current step/open state. Local storage remembers dismissal
 * or completion on this device; explicit replay always starts from the first step.
 * Content comes from tutorial-content.ts, shared with the reading-oriented tutorial page.
 * Invariants: steps never log in, collect, send invitations or change account data.
 * Close only through explicit buttons; native task progress remains owned by BrowserLayer.
 */

import { useEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { openBrowserDialog } from './browser'
import { useCommerce } from './store'
import { guideSteps } from './tutorial-content'

const seenKey = 'dalanchong:onboarding:v1'
const useOnboarding = create<{ open: boolean; step: number }>(() => ({
  open: false,
  step: 0,
}))

export function startOnboarding() {
  return openBrowserDialog(() => useOnboarding.setState({ open: true, step: 0 }))
}

function closeOnboarding() {
  localStorage.setItem(seenKey, 'seen')
  useOnboarding.setState({ open: false })
}

export function OnboardingGuide() {
  const { open, step } = useOnboarding()
  const autoStarted = useRef(false)
  const running = useCommerce((state) => Object.values(state.tasks)
    .some((task) => task.status === 'running'))

  useEffect(() => {
    if (autoStarted.current || running || localStorage.getItem(seenKey)) return
    autoStarted.current = true
    void startOnboarding()
  }, [running])

  const current = guideSteps[step]
  const last = step === guideSteps.length - 1

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) closeOnboarding() }}>
      <DialogContent className='flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl'>
        <DialogHeader className='shrink-0 px-6 pt-6 pr-12 pb-4 text-left'>
          <div className='flex items-center justify-between gap-4'>
            <DialogTitle>新手引导</DialogTitle>
            <span className='text-sm text-muted-foreground tabular-nums'>
              {step + 1} / {guideSteps.length}
            </span>
          </div>
          <DialogDescription>
            随时可在「使用教程」中重播。
          </DialogDescription>
        </DialogHeader>
        <Progress
          value={((step + 1) / guideSteps.length) * 100}
          aria-label='新手引导进度'
          className='h-1 shrink-0 rounded-none'
        />
        <div className='min-h-0 overflow-y-auto p-6' aria-live='polite' aria-atomic='true'>
          <div className='mb-6 flex items-start gap-4'>
            <span aria-hidden='true' className='flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-3xl'>
              {current.emoji}
            </span>
            <div className='min-w-0 space-y-2'>
              <h2 className='text-lg font-semibold'>{current.title}</h2>
              <p className='text-sm leading-6 text-muted-foreground'>{current.location}</p>
            </div>
          </div>
          <ol className='space-y-4'>
            {current.steps.map((text, index) => (
              <li key={text} className='flex items-start gap-3 text-sm leading-6'>
                <span aria-hidden='true' className='flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium tabular-nums'>
                  {index + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
        <DialogFooter className='shrink-0 border-t px-6 py-4 sm:items-center sm:justify-between'>
          <Button variant='ghost' onClick={closeOnboarding}>稍后再看</Button>
          <div className='flex justify-end gap-2'>
            <Button variant='outline' disabled={step === 0} onClick={() => useOnboarding.setState({ step: step - 1 })}>
              <ArrowLeft />上一步
            </Button>
            {last ? (
              <Button onClick={closeOnboarding}><Check />完成引导</Button>
            ) : (
              <Button onClick={() => useOnboarding.setState({ step: step + 1 })}>下一步<ArrowRight /></Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

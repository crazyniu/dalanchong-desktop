/**
 * AI module map
 * Purpose: bootstrap the transparent native task/log child WebView.
 * Entry: overlay.html loads Logs; Rust overlay.rs sends assistant:logs snapshots.
 * Flow: subscribe before requesting overlay_ready, render collect/invite content, measure
 * its DOM size, and report overlay_resize. Invitation actions are forwarded to main.
 * The native child persists through hiding. Collection keys retain local scroll/collapse
 * state through dialogs and reset it across account/task changes. Presentation revisions
 * acknowledge committed layout before showing, even when a hidden view pauses rAF.
 * Invariants: this view cannot run business commands; it has only overlay capabilities.
 * Disconnect event/resize/mutation observers on unmount and keep page backgrounds transparent.
 * Hot replacement unmounts the root before a new entry takes ownership of the view.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { CollectionLog } from './features/commerce/collection-log'
import {
  InviteProgress,
  type TaskOverlayContent,
} from './features/commerce/invite-progress'
import './log-overlay.css'
import './styles/index.css'

document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'
document.body.style.overflow = 'hidden'

type OverlayPresentation = {
  revision: number
  content: TaskOverlayContent | null
}

export function Logs() {
  const [presentation, setPresentation] = useState<OverlayPresentation>({
    revision: 0,
    content: null,
  })
  const { content, revision } = presentation
  const current = useRef(presentation)
  current.current = presentation
  const measureNow = useRef(() => {})
  useEffect(() => {
    let active = true
    let events = 0
    const subscription = listen<OverlayPresentation>(
      'assistant:logs',
      ({ payload }) => {
        events++
        if (active) setPresentation(payload)
      }
    )
    void subscription
      .then(async () => {
        if (!active) return
        const before = events
        const initial = await invoke<OverlayPresentation>('overlay_ready')
        if (active && events === before) setPresentation(initial)
      })
      .catch(console.error)
    return () => {
      active = false
      void subscription.then((unsubscribe) => unsubscribe())
    }
  }, [])
  useLayoutEffect(() => {
    const root = document.getElementById('root')!
    let frame = 0
    let previousWidth = 0
    let previousHeight = 0
    let previousRevision = -1
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = 0
      const { content, revision } = current.current
      if (!content) return
      const card = root.firstElementChild
      if (card) {
        const { width, height } = card.getBoundingClientRect()
        const nextWidth = Math.ceil(width + 32)
        const nextHeight = Math.ceil(height + 32)
        if (nextWidth === previousWidth && nextHeight === previousHeight &&
            revision === previousRevision) return
        previousWidth = nextWidth
        previousHeight = nextHeight
        previousRevision = revision
        void invoke('overlay_resize', {
          width: nextWidth,
          height: nextHeight,
          revision,
        }).catch(console.error)
      }
    }
    const scheduleMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(scheduleMeasure)
    const mutation = new MutationObserver(() => {
      observer.disconnect()
      if (root.firstElementChild) observer.observe(root.firstElementChild)
      scheduleMeasure()
    })
    mutation.observe(root, { childList: true })
    measureNow.current = measure
    if (root.firstElementChild) observer.observe(root.firstElementChild)
    scheduleMeasure()
    return () => {
      observer.disconnect()
      mutation.disconnect()
      cancelAnimationFrame(frame)
      measureNow.current = () => {}
    }
  }, [])
  useLayoutEffect(() => {
    measureNow.current()
  }, [revision])
  if (!content) return null
  return content.kind === 'invite' ? (
    <InviteProgress
      state={content}
      onAction={(action) => {
        void invoke('overlay_action', { action, revision })
      }}
    />
  ) : (
    <CollectionLog
      key={`${content.task.accountId}:${content.task.startedAt}`}
      task={content.task}
    />
  )
}
const root = createRoot(document.getElementById('root')!)
root.render(<Logs />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())

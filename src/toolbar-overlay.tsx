/**
 * AI module map
 * Purpose: bootstrap the bottom native toolbar child WebView for invitation pages.
 * Entry: toolbar.html loads ToolbarOverlay; toolbar.rs publishes assistant:toolbar state.
 * Flow: subscribe then request toolbar_ready, render invitation controls, measure the toolbar
 * and portaled menus, report height, and forward account-scoped actions to main.
 * Grip movement coalesces into one pending delta while native movement is in flight.
 * Rust retains and bounds the position.
 * A revision identifies each native presentation, independent of ordinary progress
 * updates. Commit and measure synchronously on restoration even when native hiding
 * pauses animation frames; resize acknowledges that revision before Rust reveals it.
 * Invariants: no main-store access or privileged business IPC; preserve bottom spacing
 * and menu measurement so native clipping does not hide dropdown controls.
 * Hot replacement unmounts the root to release event, observer, and drag-frame ownership.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { CollectionToolbar } from './features/commerce/collection-toolbar'
import type { NativeToolbarState } from './features/commerce/browser'
import './styles/index.css'
import './toolbar-overlay.css'

type ToolbarPresentation = {
  revision: number
  state: NativeToolbarState | null
}

export function ToolbarOverlay() {
  const [presentation, setPresentation] = useState<ToolbarPresentation>({
    revision: 0,
    state: null,
  })
  const { state, revision } = presentation
  const current = useRef(presentation)
  current.current = presentation
  const measureNow = useRef(() => {})
  const movement = useRef({ x: 0, y: 0, frame: 0, running: false })
  function move(deltaX: number, deltaY: number) {
    const pending = movement.current
    pending.x += deltaX
    pending.y += deltaY
    if (pending.frame || pending.running || (!pending.x && !pending.y)) return
    pending.frame = requestAnimationFrame(() => {
      pending.frame = 0
      const { x, y } = pending
      pending.x = 0
      pending.y = 0
      pending.running = true
      void invoke<void>('toolbar_move', {
        deltaX: x, deltaY: y, revision: current.current.revision,
      })
        .catch(console.error)
        .finally(() => {
          pending.running = false
          move(0, 0)
        })
    })
  }
  useEffect(() => {
    let active = true
    let events = 0
    const subscription = listen<ToolbarPresentation>(
      'assistant:toolbar',
      ({ payload }) => {
        events++
        if (active) setPresentation(payload)
      }
    )
    void subscription
      .then(async () => {
        if (!active) return
        const before = events
        const initial = await invoke<ToolbarPresentation>('toolbar_ready')
        if (active && events === before) setPresentation(initial)
      })
      .catch(console.error)
    return () => {
      active = false
      cancelAnimationFrame(movement.current.frame)
      movement.current.x = 0
      movement.current.y = 0
      void subscription.then((unsubscribe) => unsubscribe())
    }
  }, [])
  useLayoutEffect(() => {
    let frame = 0
    let previousHeight = 0
    let previousRevision = -1
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = 0
      const { state, revision } = current.current
      if (!state) return
      const bar = document.querySelector('.floating-toolbar')
      if (!bar) return
      const menu = document.querySelector('[data-slot="dropdown-menu-content"]')
      const height =
        bar.getBoundingClientRect().height +
        32 +
        (menu ? menu.getBoundingClientRect().height + 4 : 0)
      const nextHeight = Math.ceil(height)
      if (nextHeight === previousHeight && revision === previousRevision) return
      previousHeight = nextHeight
      previousRevision = revision
      void invoke('toolbar_resize', { height: nextHeight, revision }).catch(console.error)
    }
    const scheduleMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(scheduleMeasure)
    let observed = new Set<Element>()
    const observe = () => {
      const next = new Set(document.querySelectorAll(
          '.floating-toolbar, [data-slot="dropdown-menu-content"]'
        ))
      let changed = false
      for (const element of observed) {
        if (!next.has(element)) {
          resize.unobserve(element)
          changed = true
        }
      }
      for (const element of next) {
        if (!observed.has(element)) {
          resize.observe(element)
          changed = true
        }
      }
      observed = next
      if (changed) scheduleMeasure()
    }
    const mutation = new MutationObserver(observe)
    mutation.observe(document.body, { childList: true, subtree: true })
    measureNow.current = measure
    observe()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      cancelAnimationFrame(frame)
      measureNow.current = () => {}
    }
  }, [])
  useLayoutEffect(() => {
    const pending = movement.current
    cancelAnimationFrame(pending.frame)
    pending.frame = 0
    pending.x = 0
    pending.y = 0
  }, [revision])
  useLayoutEffect(() => {
    measureNow.current()
  }, [revision])
  return (
    state && (
      <div className='floating-toolbar'>
        <CollectionToolbar
          key={state.accountId}
          state={state}
          onMove={move}
          onAction={(action) => {
            void invoke('toolbar_action', {
              accountId: state.accountId,
              action,
              revision,
            })
          }}
        />
      </div>
    )
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<ToolbarOverlay />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())

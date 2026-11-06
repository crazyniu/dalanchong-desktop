import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  CollectionToolbar,
  type ToolbarState,
} from './features/commerce/collection-toolbar'
import './styles/index.css'
import './toolbar-overlay.css'

export function ToolbarOverlay() {
  const [state, setState] = useState<ToolbarState | null>(null)
  useEffect(() => {
    const subscription = listen<ToolbarState | null>(
      'assistant:toolbar',
      ({ payload }) => setState(payload)
    )
    void subscription
      .then(() => invoke<ToolbarState | null>('toolbar_ready'))
      .then(setState)
    return () => {
      void subscription.then((unsubscribe) => unsubscribe())
    }
  }, [])
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector('.floating-toolbar')
      if (!bar) return
      const menu = document.querySelector('[data-slot="dropdown-menu-content"]')
      const height =
        bar.getBoundingClientRect().height +
        32 +
        (menu ? menu.getBoundingClientRect().height + 4 : 0)
      void invoke('toolbar_resize', { height: Math.ceil(height) })
    }
    const resize = new ResizeObserver(measure)
    const observe = () => {
      resize.disconnect()
      document
        .querySelectorAll(
          '.floating-toolbar, [data-slot="dropdown-menu-content"]'
        )
        .forEach((element) => resize.observe(element))
      measure()
    }
    const mutation = new MutationObserver(observe)
    mutation.observe(document.body, { childList: true, subtree: true })
    observe()
    return () => {
      resize.disconnect()
      mutation.disconnect()
    }
  }, [])
  return (
    state && (
      <div className='floating-toolbar'>
        <CollectionToolbar
          key={state.accountId}
          state={state}
          onAction={(action) => {
            void invoke('toolbar_action', {
              accountId: state.accountId,
              action,
            })
          }}
        />
      </div>
    )
  )
}

createRoot(document.getElementById('root')!).render(<ToolbarOverlay />)

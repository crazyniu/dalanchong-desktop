import { useEffect, useState } from 'react'
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

export function Logs() {
  const [content, setContent] = useState<TaskOverlayContent | null>(null)
  useEffect(() => {
    const subscription = listen<TaskOverlayContent>(
      'assistant:logs',
      ({ payload }) => setContent(payload)
    )
    void subscription
      .then(() => invoke<TaskOverlayContent | null>('overlay_ready'))
      .then(setContent)
    return () => {
      void subscription.then((unsubscribe) => unsubscribe())
    }
  }, [])
  useEffect(() => {
    const root = document.getElementById('root')!
    const measure = () => {
      const card = root.firstElementChild
      if (card) {
        const { width, height } = card.getBoundingClientRect()
        void invoke('overlay_resize', {
          width: width + 32,
          height: height + 32,
        })
      }
    }
    const observer = new ResizeObserver(measure)
    const mutation = new MutationObserver(() => {
      observer.disconnect()
      if (root.firstElementChild) observer.observe(root.firstElementChild)
      measure()
    })
    mutation.observe(root, { childList: true })
    if (root.firstElementChild) observer.observe(root.firstElementChild)
    measure()
    return () => {
      observer.disconnect()
      mutation.disconnect()
    }
  }, [])
  if (!content) return null
  return content.kind === 'invite' ? (
    <InviteProgress
      state={content}
      onAction={(action) => {
        void invoke('overlay_action', { action })
      }}
    />
  ) : (
    <CollectionLog
      key={`${content.task.accountId}:${content.task.startedAt}`}
      task={content.task}
    />
  )
}
createRoot(document.getElementById('root')!).render(<Logs />)

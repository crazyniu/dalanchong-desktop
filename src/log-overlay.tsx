import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { CollectionLog } from './features/commerce/collection-log'
import type { Task } from './features/commerce/types'
import './log-overlay.css'
import './styles/index.css'

document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'
document.body.style.overflow = 'hidden'

export function Logs() {
  const [task, setTask] = useState<Task>()
  useEffect(() => {
    const subscription = listen<Task>('assistant:logs', ({ payload }) =>
      setTask(payload)
    )
    void subscription
      .then(() => invoke<Task | null>('overlay_ready'))
      .then((current) => {
        if (current) setTask(current)
      })
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
  }, [task?.startedAt])
  return task ? <CollectionLog task={task} /> : null
}
createRoot(document.getElementById('root')!).render(<Logs />)

/**
 * AI module map
 * Purpose: show local video thumbnails and an explicit-close video preview without reading file bytes into JS.
 * Entry: the montage table uses VideoThumbnail; VideoPreviewDialog owns the enlarged native HTML player.
 * Flow: only visible thumbnail rows attach a montage-video protocol URL; metadata seeks the paused player
 * to its first useful frame. Native directory listing grants exact readable paths to the main WebView.
 * Ownership: each media effect pauses and releases its source on unmount; closing/deleting a preview
 * unmounts its player immediately. Removal callbacks affect the list/pool only, never the filesystem.
 */

import { useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Film, LoaderCircle, Trash2, VideoOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export type PreviewVideo = {
  path: string
  name: string
}

/** Attach one authorized local URL and release decoder/file resources for every teardown. */
function useLocalVideo(path: string, enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!enabled) return
    const video = videoRef.current!
    video.src = convertFileSrc(path, 'montage-video')
    video.load()
    return () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [path, enabled])
  return videoRef
}

export function VideoThumbnail({ video, onPreview }: {
  video: PreviewVideo
  onPreview: () => void
}) {
  const targetRef = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const videoRef = useLocalVideo(video.path, visible)

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        setState(entry.isIntersecting ? 'loading' : 'idle')
        setVisible(entry.isIntersecting)
      }
    }, { rootMargin: '200px' })
    observer.observe(targetRef.current!)
    return () => observer.disconnect()
  }, [])

  return (
    <button
      ref={targetRef}
      type='button'
      aria-label={`预览 ${video.name}`}
      onClick={onPreview}
      className='relative flex h-20 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      <video
        ref={videoRef}
        aria-hidden='true'
        muted
        playsInline
        preload='metadata'
        tabIndex={-1}
        className={cn('absolute inset-0 h-full w-full object-cover', state !== 'ready' && 'opacity-0')}
        onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2) }}
        onLoadedData={() => setState('ready')}
        onError={() => setState('error')}
      />
      {state === 'loading' ? <LoaderCircle className='size-4 motion-safe:animate-spin' aria-hidden='true' />
        : state === 'error' ? <VideoOff className='size-4' aria-hidden='true' />
          : state === 'idle' ? <Film className='size-4' aria-hidden='true' /> : null}
    </button>
  )
}

export function VideoPreviewDialog({ video, canRemove, onClose, onRemove }: {
  video: PreviewVideo | null
  canRemove: boolean
  onClose: () => void
  onRemove: (path: string) => void
}) {
  return (
    <Dialog open={video !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className='gap-4 sm:max-w-3xl'>
        <DialogHeader className='min-w-0 pr-6 text-left'>
          <DialogTitle className='truncate'>{video?.name ?? '视频预览'}</DialogTitle>
          <DialogDescription className='sr-only'>视频预览</DialogDescription>
        </DialogHeader>
        {video && <PreviewPlayer key={video.path} video={video} />}
        <DialogFooter className='flex-row items-center justify-between sm:justify-between'>
          <Button
            type='button'
            variant='outline'
            className='text-destructive'
            disabled={!canRemove || video === null}
            onClick={() => { if (video) onRemove(video.path) }}
          ><Trash2 />从列表移除</Button>
          <Button type='button' onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewPlayer({ video }: { video: PreviewVideo }) {
  const videoRef = useLocalVideo(video.path, true)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  return (
    <div className='relative flex min-h-56 items-center justify-center overflow-hidden rounded-lg bg-black'>
      <video
        ref={videoRef}
        controls
        playsInline
        preload='metadata'
        aria-label={video.name}
        className='max-h-[60vh] w-full object-contain'
        onLoadedData={() => setState('ready')}
        onError={() => setState('error')}
      />
      {state !== 'ready' && (
        <div role={state === 'error' ? 'alert' : 'status'} className='pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/70 px-5 py-10 text-sm text-white'>
          {state === 'loading' && <LoaderCircle className='size-5 motion-safe:animate-spin' aria-hidden='true' />}
          {state === 'error' ? '无法预览此视频' : '正在加载视频…'}
        </div>
      )}
    </div>
  )
}

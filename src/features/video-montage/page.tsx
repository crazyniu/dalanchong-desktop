/**
 * AI module map
 * Purpose: select Mac montage targets, configure their shared settings, and display real progress.
 * Entry: VideoMontagePage is the guarded /video-montage lazy route.
 * Flow: selected source files are targets with one copy count; unselected files stay in the donor pool.
 * Removing an item excludes it from both pools for this source directory/session, never disk.
 * The required background directory supplies the full-frame backdrop and high-FPS filler frames.
 * Native events/snapshots own progress/results. Only settings persist locally. A shared revision
 * excludes older state/start/cancel replies after a newer native event has been received.
 * Invariants: changing routes does not stop native work. Disabled configuration follows actual
 * running/submission state; stop remains independent of license state. The table keeps progress
 * and output counts; the floating terminal owns stage/status feedback. No simulated progress.
 */

import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Eye, FolderOpen, LoaderCircle, Play, RefreshCw, Square, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/ui/loading-state'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Choice } from '@/features/commerce/shared'
import {
  cancelMontage,
  getMontageSnapshot,
  openMontageDirectory,
  pickMontageDirectory,
  startMontage,
} from './api'
import { useMacVideoMontage } from './platform'
import { MontageLog } from './logs'
import { VideoPreviewDialog, VideoThumbnail, type PreviewVideo } from './media'
import {
  acceptMontageSnapshot,
  montageSnapshotVersion,
  readMontageDirectory,
  useVideoMontage,
} from './store'
import type { DirectoryKind, MontageProgress, MontageSnapshot } from './types'

export function VideoMontagePage() {
  const available = useMacVideoMontage()
  return available ? <VideoMontageWorkspace /> : null
}

function VideoMontageWorkspace() {
  const { settings, videos, selectedPaths, excludedPaths, snapshot, scanning, error, setSettings, setSelected, selectAll, removeVideo } = useVideoMontage()
  const [picking, setPicking] = useState<DirectoryKind | null>(null)
  const [opening, setOpening] = useState('')
  const [initializing, setInitializing] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [preview, setPreview] = useState<PreviewVideo | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const busy = snapshot.running || initializing || submitting || scanning || picking !== null
  const currentPaths = new Set(videos.map((video) => video.path))
  const excluded = new Set(excludedPaths)
  const selected = new Set(snapshot.running ? snapshot.rows.map((row) => row.sourcePath) : selectedPaths)
  const selectedCount = snapshot.running ? snapshot.rows.length : videos.filter((video) => selected.has(video.path)).length
  const progressByPath = new Map(snapshot.rows.map((row) => [row.sourcePath, row]))
  // Retain native rows for active jobs or a failed scan, not an intentionally emptied source list.
  const rows: MontageProgress[] = videos.length > 0 ? videos.map((video) =>
    progressByPath.get(video.path) ?? {
      sourcePath: video.path,
      name: video.relativePath,
      status: selected.has(video.path) ? 'waiting' : 'material',
      stage: selected.has(video.path) ? '待处理' : '—',
      progress: 0,
      completed: 0,
      total: selected.has(video.path) ? settings.defaultCopies : 0,
      outputPaths: [],
      error: null,
    },
  ) : snapshot.running || (error !== '' && excludedPaths.length === 0)
    ? snapshot.rows.filter((row) => !excluded.has(row.sourcePath))
    : []
  const allSelected = videos.length > 0 && selectedCount === videos.length
  const planned = snapshot.running ? snapshot.rows.reduce((total, row) => total + row.total, 0) : selectedCount * settings.defaultCopies
  const message = error || snapshot.error
  const canStart = !busy && settings.sourceDir !== '' && settings.backgroundDir !== ''
    && settings.outputDir !== '' && selectedCount > 0

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    async function connect() {
      try {
        const stop = await listen<MontageSnapshot>('video-montage:state', (event) => {
          if (!disposed) acceptMontageSnapshot(event.payload)
        })
        if (disposed) { stop(); return }
        unsubscribe = stop
        const version = montageSnapshotVersion()
        const state = await getMontageSnapshot()
        if (!disposed && version === montageSnapshotVersion()) acceptMontageSnapshot(state)
      } catch (reason) {
        if (!disposed) useVideoMontage.setState({ error: String(reason) })
      } finally {
        if (!disposed) setInitializing(false)
      }
    }
    void connect()
    const draft = useVideoMontage.getState()
    if (draft.settings.sourceDir && !draft.scanning) void readMontageDirectory(draft.settings.sourceDir)
    return () => { disposed = true; unsubscribe?.() }
  }, [])

  async function chooseDirectory(kind: DirectoryKind) {
    setPicking(kind)
    try {
      const path = await pickMontageDirectory(kind)
      if (path === null) return
      if (kind === 'source') {
        await readMontageDirectory(path)
      } else if (kind === 'background') {
        setSettings({ backgroundDir: path })
      } else {
        setSettings(kind === 'intro' ? { introDir: path } : { outputDir: path })
      }
    } catch (reason) {
      toast.error(String(reason))
    } finally {
      setPicking(null)
    }
  }

  async function openOutput(path: string) {
    setOpening(path)
    try {
      await openMontageDirectory(path)
    } catch (reason) {
      toast.error(String(reason))
    } finally {
      setOpening('')
    }
  }

  async function start() {
    setSubmitting(true)
    useVideoMontage.setState({ error: '' })
    const version = montageSnapshotVersion()
    try {
      const draft = useVideoMontage.getState()
      const targets = draft.videos.filter((video) => draft.selectedPaths.includes(video.path)).map((video) => video.path)
      const state = await startMontage({ ...draft.settings }, targets, draft.excludedPaths)
      if (version === montageSnapshotVersion()) acceptMontageSnapshot(state)
    } catch (reason) {
      useVideoMontage.setState({ error: String(reason) })
    } finally {
      setSubmitting(false)
    }
  }

  async function stop() {
    setCancelling(true)
    const version = montageSnapshotVersion()
    try {
      const state = await cancelMontage()
      if (version === montageSnapshotVersion()) acceptMontageSnapshot(state)
    } catch (reason) {
      useVideoMontage.setState({ error: String(reason) })
    } finally {
      setCancelling(false)
    }
  }

  function removeFromList(path: string) {
    removeVideo(path)
    if (preview?.path === path) setPreview(null)
    toast.success('已从列表移除')
  }

  return (
    <main className='relative flex h-svh min-h-0 min-w-0 flex-col bg-muted/30'>
      <div className='workspace-toolbar shrink-0'>
        <div className='page-toolbar'>
          <h1 className='text-2xl font-semibold'>视频混剪</h1>
        </div>
      </div>
      <div className='relative min-h-0 flex-1'>
        <div className='h-full space-y-4 overflow-y-auto px-5 pt-3 pb-5'>
          <Card className='gap-5 py-5 shadow-none'>
            <CardHeader className='px-5'>
              <CardTitle className='text-base'>目录与参数</CardTitle>
            </CardHeader>
            <CardContent className='space-y-5 px-5'>
              <div className='space-y-3'>
                <DirectoryField
                  id='montage-source'
                  label='爆款视频目录'
                  value={settings.sourceDir}
                  disabled={busy}
                  picking={picking === 'source'}
                  onPick={() => void chooseDirectory('source')}
                  onReload={settings.sourceDir ? () => void readMontageDirectory(settings.sourceDir) : undefined}
                />
                <DirectoryField
                  id='montage-background'
                  label='画中画视频目录'
                  value={settings.backgroundDir}
                  disabled={busy}
                  picking={picking === 'background'}
                  onPick={() => void chooseDirectory('background')}
                />
                <DirectoryField
                  id='montage-intro'
                  label='前贴目录（可选）'
                  value={settings.introDir}
                  disabled={busy}
                  picking={picking === 'intro'}
                  onPick={() => void chooseDirectory('intro')}
                  onClear={settings.introDir ? () => setSettings({ introDir: '' }) : undefined}
                />
                <DirectoryField
                  id='montage-output'
                  label='导出目录'
                  value={settings.outputDir}
                  disabled={busy}
                  picking={picking === 'output'}
                  onPick={() => void chooseDirectory('output')}
                />
              </div>
              <div className='grid gap-x-6 gap-y-5 border-t pt-5 sm:grid-cols-2 xl:grid-cols-5 xl:gap-x-4'>
                <div className='space-y-2'>
                  <Label htmlFor='montage-copies'>裂变数量</Label>
                  <NumberInput
                    id='montage-copies'
                    label='裂变数量'
                    value={settings.defaultCopies}
                    min={1}
                    max={99}
                    disabled={busy}
                    onValueChange={(defaultCopies) => setSettings({ defaultCopies })}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='montage-workers'>线程数</Label>
                  <NumberInput
                    id='montage-workers'
                    label='线程数'
                    value={settings.workers}
                    min={1}
                    max={99}
                    disabled={busy}
                    onValueChange={(workers) => setSettings({ workers })}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='montage-scale'>主体画面比例</Label>
                  <NumberInput
                    id='montage-scale'
                    label='主体画面比例'
                    value={settings.scalePercent}
                    min={50}
                    max={100}
                    suffix='%'
                    disabled={busy}
                    onValueChange={(scalePercent) => setSettings({ scalePercent })}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='montage-opacity'>主画面不透明度</Label>
                  <NumberInput
                    id='montage-opacity'
                    label='主画面不透明度'
                    value={settings.opacityPercent}
                    min={1}
                    max={100}
                    suffix='%'
                    disabled={busy}
                    onValueChange={(opacityPercent) => setSettings({ opacityPercent })}
                  />
                </div>
                <div className='space-y-2'>
                  <Label>导出帧率</Label>
                  <div className='flex gap-2'>
                    <Choice
                      value={settings.frameMode}
                      label='导出帧率'
                      className='min-w-0 flex-1'
                      disabled={busy}
                      onChange={(value) => setSettings({ frameMode: value as 'default' | 'high' })}
                      options={[{ value: 'default', label: '默认' }, { value: 'high', label: '高帧率' }]}
                    />
                    {settings.frameMode === 'high' && (
                      <NumberInput
                        label='高帧率'
                        value={settings.highFps}
                        min={121}
                        max={240}
                        disabled={busy}
                        onValueChange={(highFps) => setSettings({ highFps })}
                        className='w-20 shrink-0'
                      />
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className='gap-0 overflow-hidden py-0 shadow-none'>
            <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3 px-5 py-4'>
              <CardTitle className='flex items-center gap-2 text-base'>
                视频列表
                <span className='text-sm font-normal text-muted-foreground tabular-nums'>{rows.length}</span>
              </CardTitle>
              {videos.length > 0 && <span className='text-sm text-muted-foreground tabular-nums'>已选 {selectedCount} 个</span>}
            </CardHeader>
            {message && <div role='alert' className='border-t px-5 py-3 text-sm text-destructive wrap-anywhere'>{message}</div>}
            {initializing || scanning ? (
              <LoadingState label={initializing ? '正在读取任务…' : '正在读取视频…'} className='min-h-56 border-t' />
            ) : rows.length === 0 ? (
              <div className='flex min-h-56 items-center justify-center border-t px-5 py-8 text-sm text-muted-foreground'>暂无视频</div>
            ) : (
              <Table className='min-w-[720px] border-t'>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-12 pl-5'>
                      <Checkbox
                        aria-label='选择全部视频'
                        checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
                        disabled={busy || videos.length === 0}
                        onCheckedChange={(value) => selectAll(value === true)}
                      />
                    </TableHead>
                    <TableHead>视频</TableHead>
                    <TableHead className='w-40'>进度</TableHead>
                    <TableHead className='w-28'>完成份数</TableHead>
                    <TableHead className='w-32 pr-5'>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.sourcePath}>
                      <TableCell className='pl-5'>
                        <Checkbox
                          aria-label={`选择 ${row.name}`}
                          checked={selected.has(row.sourcePath)}
                          disabled={busy || !currentPaths.has(row.sourcePath)}
                          onCheckedChange={(value) => setSelected(row.sourcePath, value === true)}
                        />
                      </TableCell>
                      <TableCell className='min-w-52 max-w-0'>
                        <div className='flex items-center gap-3'>
                          <VideoThumbnail video={{ path: row.sourcePath, name: row.name }} onPreview={() => setPreview({ path: row.sourcePath, name: row.name })} />
                          <div className='min-w-0 flex-1'>
                            <button
                              type='button'
                              className='block max-w-full truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'
                              title={row.sourcePath}
                              aria-label={`预览 ${row.name}`}
                              onClick={() => setPreview({ path: row.sourcePath, name: row.name })}
                            >{row.name}</button>
                            {row.error && <p className='mt-1 line-clamp-2 whitespace-normal text-destructive wrap-anywhere' title={row.error}>{row.error}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.status === 'material' ? <span className='text-muted-foreground'>—</span> : <div className='flex items-center gap-3'>
                          <Progress value={row.progress} aria-label={`${row.name} 的处理进度`} className='h-1.5 flex-1' />
                          <span className='w-10 text-right text-muted-foreground tabular-nums'>{Math.round(row.progress)}%</span>
                        </div>}
                      </TableCell>
                      <TableCell className='text-muted-foreground tabular-nums'>{row.status === 'material' ? '—' : `${row.completed} / ${row.total}`}</TableCell>
                      <TableCell className='pr-5'>
                        <div className='flex items-center gap-1'>
                          <Button
                            type='button'
                            size='icon'
                            variant='ghost'
                            aria-label={`预览 ${row.name}`}
                            title='预览'
                            onClick={() => setPreview({ path: row.sourcePath, name: row.name })}
                          ><Eye /></Button>
                          <Button
                            type='button'
                            size='icon'
                            variant='ghost'
                            className='text-destructive'
                            disabled={busy}
                            aria-label={`从列表移除 ${row.name}`}
                            title='从列表移除'
                            onClick={() => removeFromList(row.sourcePath)}
                          ><Trash2 /></Button>
                          {row.outputPaths.length > 0 && (
                            <Button
                              type='button'
                              size='icon'
                              variant='ghost'
                              disabled={opening !== ''}
                              aria-label={`打开 ${row.name} 的成片目录`}
                              onClick={() => void openOutput(row.outputPaths[0].slice(0, row.outputPaths[0].lastIndexOf('/')))}
                            ><FolderOpen /></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
        <MontageLog open={logsOpen} snapshot={snapshot} onOpenChange={setLogsOpen} />
      </div>
      <div className='flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-5 py-4'>
        <p className='text-sm text-muted-foreground tabular-nums'>已选 {selectedCount} 个视频 · 共 {planned} 份</p>
        <div className='flex flex-wrap items-center gap-3'>
          <Button type='button' variant='outline' disabled={!settings.outputDir || opening !== ''} onClick={() => void openOutput(settings.outputDir)}>
            {opening === settings.outputDir ? <LoaderCircle className='motion-safe:animate-spin' /> : <FolderOpen />}
            打开导出目录
          </Button>
          {snapshot.running ? (
            <Button type='button' variant='outline' disabled={cancelling} onClick={() => void stop()}>
              {cancelling ? <LoaderCircle className='motion-safe:animate-spin' /> : <Square />}
              {cancelling ? '停止中' : '停止'}
            </Button>
          ) : (
            <Button type='button' disabled={!canStart} onClick={() => void start()}>
              {submitting ? <LoaderCircle className='motion-safe:animate-spin' /> : <Play />}
              {submitting ? '正在启动' : '开始处理'}
            </Button>
          )}
        </div>
      </div>
      <VideoPreviewDialog
        video={preview}
        canRemove={!busy && preview !== null}
        onClose={() => setPreview(null)}
        onRemove={removeFromList}
      />
    </main>
  )
}

function DirectoryField({ id, label, value, disabled, picking, onPick, onClear, onReload }: {
  id: string
  label: string
  value: string
  disabled: boolean
  picking: boolean
  onPick: () => void
  onClear?: () => void
  onReload?: () => void
}) {
  return (
    <div className='grid items-center gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4'>
      <Label htmlFor={id}>{label}</Label>
      <div className='flex min-w-0 items-center gap-2'>
        <Input id={id} readOnly value={value} placeholder='未选择' title={value} className='min-w-0 bg-muted/20' />
        {onClear && <Button type='button' size='icon' variant='ghost' disabled={disabled} aria-label='清空前贴目录' onClick={onClear}><X /></Button>}
        {onReload && <Button type='button' size='icon' variant='ghost' disabled={disabled} aria-label='重新读取爆款视频目录' onClick={onReload}><RefreshCw /></Button>}
        <Button type='button' variant='outline' disabled={disabled} onClick={onPick} aria-label={`选择${label}`}>
          {picking ? <LoaderCircle className='motion-safe:animate-spin' /> : <FolderOpen />}
          选择
        </Button>
      </div>
    </div>
  )
}

function NumberInput({ id, label, value, min, max, suffix, disabled, className, onValueChange }: {
  id?: string
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  disabled?: boolean
  className?: string
  onValueChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  function commit() {
    const next = Number(draft)
    if (!Number.isInteger(next) || next < min || next > max) {
      toast.error(`${label}需为 ${min}～${max} 的整数`)
      setDraft(String(value))
      return
    }
    onValueChange(next)
  }
  return (
    <div className={`relative ${className ?? ''}`}>
      <Input
        id={id}
        type='number'
        inputMode='numeric'
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={draft}
        disabled={disabled}
        className={suffix ? 'pr-8 tabular-nums' : 'tabular-nums'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
      {suffix && <span className='pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground'>{suffix}</span>}
    </div>
  )
}

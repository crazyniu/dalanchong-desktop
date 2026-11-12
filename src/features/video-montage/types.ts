/**
 * AI module map
 * Purpose: define video-montage settings, native source records, and authoritative job progress.
 * Entry: page.tsx, api.ts and store.ts share these shapes with video_montage_* IPC/events.
 * Flow: selected source paths are output targets; all sources remain available as donors.
 * A separate required background directory supplies the backdrop and high-FPS filler frames.
 * Invariants: progress/results come from native snapshots, never from local timers or settings.
 */

export type MontageVideo = {
  path: string
  name: string
  relativePath: string
  size: number
  durationSeconds: number | null
}

export type MontageSettings = {
  sourceDir: string
  backgroundDir: string
  introDir: string
  outputDir: string
  defaultCopies: number
  workers: number
  scalePercent: number
  opacityPercent: number
  frameMode: 'default' | 'high'
  highFps: number
}

export type DirectoryKind = 'source' | 'background' | 'intro' | 'output'

export type MontageProgress = {
  sourcePath: string
  name: string
  status: string
  stage: string
  progress: number
  completed: number
  total: number
  outputPaths: string[]
  error: string | null
}

export type MontageSnapshot = {
  revision: number
  running: boolean
  status: string
  rows: MontageProgress[]
  logs: MontageLog[]
  outputDir: string
  error: string | null
}

export type MontageLog = {
  id: string
  timestamp: number
  sourcePath: string
  videoName: string
  level: string
  message: string
}

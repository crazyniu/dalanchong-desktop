/**
 * AI module map
 * Purpose: retain montage settings separately from source selection and native job state.
 * Entry: useVideoMontage serves the page; readMontageDirectory scans actual source files.
 * Flow: only settings persist locally. Native snapshots/event results survive route navigation in memory;
 * native revisions order worker events; a local counter also excludes older in-flight IPC replies.
 * Ownership: selection and exclusions survive navigation only. A new directory/session restores
 * original files. Unselected files remain donors; removed files are excluded from the native pool.
 * This store never deletes media, writes source folders, or invents job progress/log entries.
 * Invariants: canceling a picker changes nothing; scan failure retains the accepted directory/list.
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { listMontageVideos } from './api'
import type { MontageSettings, MontageSnapshot, MontageVideo } from './types'

type MontageDraft = {
  settings: MontageSettings
  videos: MontageVideo[]
  selectedPaths: string[]
  excludedPaths: string[]
  snapshot: MontageSnapshot
  scanning: boolean
  error: string
  setSettings: (patch: Partial<MontageSettings>) => void
  setSelected: (path: string, selected: boolean) => void
  selectAll: (selected: boolean) => void
  removeVideo: (path: string) => void
}

let snapshotVersion = 0

export function montageSnapshotVersion() {
  return snapshotVersion
}

export function acceptMontageSnapshot(snapshot: MontageSnapshot) {
  if (snapshot.revision < useVideoMontage.getState().snapshot.revision) return
  snapshotVersion += 1
  useVideoMontage.setState({ snapshot })
}

export const useVideoMontage = create<MontageDraft>()(
  persist(
    (set) => ({
      settings: {
        sourceDir: '',
        backgroundDir: '',
        introDir: '',
        outputDir: '',
        defaultCopies: 1,
        workers: 5,
        scalePercent: 99,
        opacityPercent: 92,
        frameMode: 'default',
        highFps: 240,
      },
      videos: [],
      selectedPaths: [],
      excludedPaths: [],
      snapshot: { revision: 0, running: false, status: 'idle', rows: [], logs: [], outputDir: '', error: null },
      scanning: false,
      error: '',
      setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
      setSelected: (path, selected) => set((state) => ({
        selectedPaths: state.videos
          .filter((video) => video.path === path ? selected : state.selectedPaths.includes(video.path))
          .map((video) => video.path),
      })),
      selectAll: (selected) => set((state) => ({
        selectedPaths: selected ? state.videos.map((video) => video.path) : [],
      })),
      removeVideo: (path) => set((state) => ({
        videos: state.videos.filter((video) => video.path !== path),
        selectedPaths: state.selectedPaths.filter((selected) => selected !== path),
        excludedPaths: [...state.excludedPaths, path],
      })),
    }),
    {
      name: 'dalanchong:video-montage:v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ settings: state.settings }),
      merge: (saved, current) => ({
        ...current,
        settings: {
          ...current.settings,
          ...(saved as { settings?: Partial<MontageSettings> } | undefined)?.settings,
        },
      }),
    },
  ),
)

export async function readMontageDirectory(path: string) {
  useVideoMontage.setState({ scanning: true, error: '' })
  try {
    const records = await listMontageVideos(path)
    useVideoMontage.setState((state) => {
      const sameDirectory = state.settings.sourceDir === path
      const excludedPaths = sameDirectory ? state.excludedPaths : []
      const videos = records.filter((video) => !excludedPaths.includes(video.path))
      return {
        videos,
        excludedPaths,
        settings: { ...state.settings, sourceDir: path },
        selectedPaths: videos.filter((video) => !sameDirectory
          || !state.videos.some((previous) => previous.path === video.path)
          || state.selectedPaths.includes(video.path))
          .map((video) => video.path),
      }
    })
  } catch (reason) {
    useVideoMontage.setState({ error: String(reason) })
  } finally {
    useVideoMontage.setState({ scanning: false })
  }
}

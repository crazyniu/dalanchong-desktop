/**
 * AI module map
 * Purpose: open Kuaishou/Douyin talent profiles from collection and invitation history.
 * Entry: openTalentProfile receives persisted talent identity from invites.tsx or records.tsx.
 * Flow: build the platform profile URL and delegate to main-only browser_open_external;
 * failures become toasts. Preview reports that a desktop browser is required.
 * Invariants: Douyin needs its actual UID, never an encrypted talent ID. Opening keeps
 * account WebViews, dialogs, and running tasks unchanged; this module owns no session state.
 */

import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { browserError } from './browser-session'
import { desktop } from './desktop'
import type { CollectedTalent } from './types'

export async function openTalentProfile(
  talent: Pick<CollectedTalent, 'platform' | 'id' | 'uid'>
) {
  if (!desktop) {
    toast.info('请在桌面端查看达人主页')
    return
  }
  let url: string
  if (talent.platform === 'kuaishou') {
    const query = new URLSearchParams({ promoterId: talent.id })
    url = `https://cps.kwaixiaodian.com/zone/daren-match/daren-detail?${query}`
  } else {
    if (!talent.uid) {
      toast.error('缺少达人 UID，请重新采集')
      return
    }
    const query = new URLSearchParams({
      uid: talent.uid,
      enter_from: '1',
      scene: '1',
      author_type: '1',
    })
    url = `https://buyin.jinritemai.com/dashboard/servicehall/daren-profile?${query}`
  }
  try {
    await invoke('browser_open_external', { url })
  } catch (error) {
    toast.error(`打开达人主页失败：${browserError(error)}`)
  }
}

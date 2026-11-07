/**
 * AI module map
 * Purpose: share an explicit confirmation UI for destructive list/history actions.
 * Entry: ClearDataButton receives the label, description, disabled state, and async onClear.
 * Flow: open confirmation, await the supplied operation, close only on success, and
 * surface failures through the toast while releasing the busy state.
 * Invariant: the caller owns scope and deletion semantics; this component never decides
 * which data to erase or treats clicking outside as confirmation.
 */

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export function ClearDataButton({
  label,
  description,
  disabled,
  onClear,
  actionLabel = '清空',
}: {
  label: string
  description: string
  disabled?: boolean
  onClear: () => Promise<void>
  actionLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  async function clear() {
    setClearing(true)
    try {
      await onClear()
      setOpen(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setClearing(false)
    }
  }
  return (
    <>
      <Button
        variant='outline'
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        {label}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label}？</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>取消</AlertDialogCancel>
            <Button variant='destructive' disabled={clearing} onClick={clear}>
              {clearing ? `正在${actionLabel}` : actionLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

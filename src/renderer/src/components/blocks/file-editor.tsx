import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { posix } from '@shared/remote'
import type { Remote } from '@/lib/remote'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface Props {
  serverId: string
  /** Absolute remote path to edit; null closes the editor. */
  path: string | null
  remote: Remote
  onClose: () => void
  /** Called after a successful save so the listing can refresh sizes and times. */
  onSaved: () => void
  /** Reading failed (binary, too large ...): the caller shows the message. */
  onError: (message: string) => void
}

/** A small text editor for config files: Ctrl/Cmd+S saves, Tab indents, unsaved changes are never dropped silently. */
export function FileEditor({ serverId, path, remote, onClose, onSaved, onError }: Props) {
  const t = useT()
  const [original, setOriginal] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const area = useRef<HTMLTextAreaElement>(null)
  const dirty = text !== original

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setLoading(true)
    setError('')
    setText('')
    setOriginal('')
    void remote.sftp.readText(serverId, path).then((r) => {
      if (cancelled) return
      setLoading(false)
      if (!r.ok) {
        onError(r.error)
        onClose()
        return
      }
      setOriginal(r.data.text)
      setText(r.data.text)
      requestAnimationFrame(() => area.current?.focus())
    })
    return () => {
      cancelled = true
    }
    // onError / onClose are stable callbacks of the parent; the file to load is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, serverId, remote])

  const save = useCallback(async (): Promise<void> => {
    if (!path || saving) return
    setSaving(true)
    setError('')
    const r = await remote.sftp.writeText(serverId, path, text)
    setSaving(false)
    if (!r.ok) return setError(r.error)
    setOriginal(text)
    onSaved()
  }, [path, saving, remote, serverId, text, onSaved])

  const requestClose = (): void => {
    if (dirty && !window.confirm(t('Discard unsaved changes?'))) return
    onClose()
  }

  const track = (el: HTMLTextAreaElement): void => {
    const before = el.value.slice(0, el.selectionStart)
    const lines = before.split('\n')
    setCursor({ line: lines.length, col: lines[lines.length - 1].length + 1 })
  }

  return (
    <Dialog open={!!path} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-3" aria-describedby={undefined}>
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 truncate font-mono text-sm">
            <span className="truncate">{path ? posix.basename(path) : ''}</span>
            {dirty && <span className="size-2 shrink-0 rounded-full bg-caution" title={t('Unsaved changes')} />}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">{path}</DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          <textarea
            ref={area}
            value={text}
            spellCheck={false}
            wrap="off"
            aria-label={t('File content')}
            disabled={loading}
            onChange={(e) => {
              setText(e.target.value)
              track(e.target)
            }}
            onSelect={(e) => track(e.currentTarget)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault()
                void save()
              } else if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: a, selectionEnd: b } = el
                const next = `${el.value.slice(0, a)}  ${el.value.slice(b)}`
                setText(next)
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
              }
            }}
            className={cn(
              'no-drag absolute inset-0 size-full resize-none select-text overflow-auto whitespace-pre bg-transparent p-3 font-mono text-[13px] leading-5 text-foreground outline-none [tab-size:2]',
              loading && 'opacity-0'
            )}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            {t('Ln {line}, Col {col}', { line: cursor.line, col: cursor.col })}
          </span>
          {error && <span className="min-w-0 flex-1 truncate text-xs text-bad">{t(error)}</span>}
          {!error && <span className="flex-1" />}
          <Button variant="ghost" onClick={requestClose}>
            {t('Close')}
          </Button>
          <Button disabled={!dirty || saving || loading} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} {t('Save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

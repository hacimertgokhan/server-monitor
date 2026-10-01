import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { octalString, parseOctalMode, validFileName } from '@/lib/files'
import { useT } from '@/lib/i18n'
import { modeString } from '@shared/remote'

/** Asks for one name (new folder, new file, rename). The name is validated before the dialog accepts it. */
export function NameDialog({
  open,
  title,
  initial,
  confirm,
  onSubmit,
  onClose
}: {
  open: boolean
  title: string
  initial: string
  confirm: string
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [value, setValue] = useState(initial)
  const [touched, setTouched] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setValue(initial)
    setTouched(false)
    // Select the name without its extension, like a file manager does.
    const dot = initial.lastIndexOf('.')
    requestAnimationFrame(() => input.current?.setSelectionRange(0, dot > 0 ? dot : initial.length))
  }, [open, initial])

  const error = validFileName(value)
  const submit = (): void => {
    setTouched(true)
    if (!error) onSubmit(value.trim())
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="grid gap-3"
        >
          <Input
            ref={input}
            autoFocus
            value={value}
            aria-label={t('Name')}
            aria-invalid={touched && !!error}
            onChange={(e) => {
              setValue(e.target.value)
              setTouched(true)
            }}
            className="font-mono"
          />
          {touched && error && <p className="text-xs text-bad">{t(error)}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!!error}>
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Confirmation for destructive actions: lists what is affected. */
export function ConfirmDialog({
  open,
  title,
  description,
  items,
  confirm,
  onConfirm,
  onClose
}: {
  open: boolean
  title: string
  description: string
  items: string[]
  confirm: string
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 select-text overflow-auto rounded-lg border border-border bg-background p-2 font-mono text-xs text-foreground">
          {items.slice(0, 50).map((i) => (
            <li key={i} className="truncate py-0.5" title={i}>
              {i}
            </li>
          ))}
          {items.length > 50 && <li className="py-0.5 text-subtle">{t('+{n} more', { n: items.length - 50 })}</li>}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="destructive" autoFocus onClick={onConfirm}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const BITS = ['r', 'w', 'x'] as const
const WHO = ['Owner', 'Group', 'Others'] as const

/** Edit unix permissions with a 3x3 checkbox grid or an octal field. */
export function PermissionsDialog({
  open,
  name,
  mode,
  onSubmit,
  onClose
}: {
  open: boolean
  name: string
  mode: number
  onSubmit: (mode: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [octal, setOctal] = useState(octalString(mode))
  useEffect(() => {
    if (open) setOctal(octalString(mode))
  }, [open, mode])

  const parsed = parseOctalMode(octal)
  const value = parsed ?? 0
  const toggle = (who: number, bit: number): void => {
    const mask = (1 << (2 - bit)) << ((2 - who) * 3)
    setOctal(octalString((parsed ?? 0) ^ mask))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('Permissions')}</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">{name}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[auto_repeat(3,1fr)] items-center gap-x-4 gap-y-2 text-sm">
          <span />
          {BITS.map((b) => (
            <span key={b} className="text-center text-[11.5px] uppercase tracking-wider text-muted-foreground">
              {b === 'r' ? t('Read') : b === 'w' ? t('Write') : t('Execute')}
            </span>
          ))}
          {WHO.map((w, wi) => (
            <div key={w} className="contents">
              <span className="text-foreground">{t(w)}</span>
              {BITS.map((b, bi) => (
                <input
                  key={b}
                  type="checkbox"
                  aria-label={`${t(w)} ${b}`}
                  checked={!!(value & ((1 << (2 - bi)) << ((2 - wi) * 3)))}
                  onChange={() => toggle(wi, bi)}
                  className="no-drag mx-auto size-4 cursor-pointer accent-[#c9c7c7]"
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Input
            value={octal}
            onChange={(e) => setOctal(e.target.value)}
            aria-label={t('Octal')}
            aria-invalid={parsed === null}
            maxLength={4}
            className="w-24 font-mono"
          />
          <span className="font-mono text-xs text-muted-foreground">{parsed === null ? t('Invalid permissions') : modeString(parsed)}</span>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button disabled={parsed === null} onClick={() => parsed !== null && onSubmit(parsed)}>
            {t('Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

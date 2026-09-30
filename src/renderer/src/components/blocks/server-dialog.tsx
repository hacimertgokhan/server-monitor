import { useEffect, useState } from 'react'
import { CheckCircle2, FolderOpen, Loader2, XCircle } from 'lucide-react'
import type { Api, ServerInfo, ServerInput, TestResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const EMPTY: ServerInput = {
  name: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password',
  password: '',
  keyPath: '',
  passphrase: ''
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  api?: Api
  editing?: ServerInfo | null
}

export function ServerDialog({ open, onOpenChange, api, editing }: Props) {
  const t = useT()
  const [form, setForm] = useState<ServerInput>(EMPTY)
  const [test, setTest] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTest(null)
    setErr(null)
    setForm(editing ? { ...EMPTY, ...editing, password: '', passphrase: '' } : EMPTY)
  }, [open, editing])

  const set = <K extends keyof ServerInput>(k: K, v: ServerInput[K]): void => {
    setForm((f) => ({ ...f, [k]: v }))
    setTest(null)
  }

  const valid = form.host.trim() && form.username.trim() && (form.authType === 'password' ? editing || form.password : form.keyPath)

  async function runTest(): Promise<void> {
    if (!api) return
    setBusy('test')
    setTest(await api.testServer(form))
    setBusy(null)
  }

  async function save(): Promise<void> {
    if (!api) return
    setBusy('save')
    try {
      await api.saveServer(form)
      onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? t(e.message) : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t('Edit server') : t('Add server')}</DialogTitle>
          <DialogDescription>
            {t(
              'Details are stored on this computer, encrypted with Windows credential protection (DPAPI). Only read-only commands run on the remote host.'
            )}
          </DialogDescription>
        </DialogHeader>

        {!api && (
          <p className="rounded-md bg-caution/10 p-3 text-xs text-caution">{t('Browser preview: use the desktop app to save servers.')}</p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 grid gap-1.5">
            <Label>{t('Display name')}</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="web-prod-01" />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label>{t('Host / IP')}</Label>
            <Input value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="203.0.113.10" />
          </div>
          <div className="grid gap-1.5">
            <Label>{t('Port')}</Label>
            <Input type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
          </div>
          <div className="col-span-3 grid gap-1.5">
            <Label>{t('User')}</Label>
            <Input value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
          </div>

          <div className="col-span-3 flex gap-1 rounded-md bg-muted p-1">
            {(['password', 'key'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set('authType', k)}
                className={cn(
                  'no-drag flex-1 rounded px-3 py-1 text-xs font-medium transition-colors',
                  form.authType === k ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {k === 'password' ? t('Password') : t('SSH key')}
              </button>
            ))}
          </div>

          {form.authType === 'password' ? (
            <div className="col-span-3 grid gap-1.5">
              <Label>
                {t('Password')} {editing && <span className="text-dim">{t('(leave empty to keep the stored password)')}</span>}
              </Label>
              <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
            </div>
          ) : (
            <>
              <div className="col-span-3 grid gap-1.5">
                <Label>{t('Private key file')}</Label>
                <div className="flex gap-2">
                  <Input value={form.keyPath} onChange={(e) => set('keyPath', e.target.value)} placeholder="C:\Users\...\.ssh\id_ed25519" />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    disabled={!api}
                    onClick={async () => {
                      const p = await api?.pickKeyFile()
                      if (p) set('keyPath', p)
                    }}
                  >
                    <FolderOpen />
                  </Button>
                </div>
              </div>
              <div className="col-span-3 grid gap-1.5">
                <Label>{t('Key passphrase (if any)')}</Label>
                <Input
                  type="password"
                  value={form.passphrase}
                  onChange={(e) => set('passphrase', e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </>
          )}
        </div>

        {test && (
          <div className={cn('flex items-start gap-2 rounded-md p-3 text-xs', test.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>
            {test.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span className="min-w-0 break-words">
              {test.ok
                ? `${t('Connected · {ms} ms', { ms: test.latencyMs ?? 0 })}${test.os ? ` · ${test.os}` : ''}`
                : test.error
                  ? t(test.error)
                  : ''}
            </span>
          </div>
        )}
        {err && <p className="text-xs text-bad">{err}</p>}

        <DialogFooter className="flex-wrap">
          <Button variant="outline" disabled={!valid || !api || busy !== null} onClick={runTest}>
            {busy === 'test' && <Loader2 className="animate-spin" />}
            {t('Test connection')}
          </Button>
          <Button disabled={!valid || !api || busy !== null} onClick={save}>
            {busy === 'save' && <Loader2 className="animate-spin" />}
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

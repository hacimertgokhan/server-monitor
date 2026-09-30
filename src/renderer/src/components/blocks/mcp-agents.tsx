import { useEffect, useState } from 'react'
import { Bot, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Capabilities, McpClientView, McpState } from '@shared/mcp'
import type { McpApi, ServerInfo } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/lib/i18n'
import { isActive, relativeTime } from '@/lib/mcp-client'
import { cn } from '@/lib/utils'
import { Snippets } from './mcp-overview'

interface Props {
  state: McpState
  mcp: McpApi
  servers: ServerInfo[]
}

const CAP_LABEL = { read: 'Read status', logs: 'Read logs', exec: 'Run commands' } as const

// ---------------------------------------------------------------- create / edit
function AgentEditor({
  open,
  onOpenChange,
  editing,
  servers,
  mcp,
  onToken
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: McpClientView | null
  servers: ServerInfo[]
  mcp: McpApi
  onToken: (name: string, token: string) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [caps, setCaps] = useState<Capabilities>({ read: true, logs: true, exec: false })
  const [all, setAll] = useState(true)
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setName(editing?.name ?? '')
    setCaps(editing?.caps ?? { read: true, logs: true, exec: false })
    setAll(editing ? editing.servers === 'all' : true)
    setPicked(editing && editing.servers !== 'all' ? editing.servers : [])
  }, [open, editing])

  const toggleServer = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const save = async (): Promise<void> => {
    setBusy(true)
    const scope = all ? 'all' : picked
    const r = editing
      ? await mcp.updateAgent(editing.id, { name, caps, servers: scope })
      : await mcp.createAgent({ name, caps, servers: scope })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onOpenChange(false)
    if (!editing && r.token) onToken(name.trim(), r.token)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? t('Edit agent') : t('New agent')}</DialogTitle>
          <DialogDescription>{t('Each agent gets its own token and its own permissions.')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label>{t('Name')}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Code" maxLength={60} />
        </div>

        <div className="grid gap-2">
          <Label>{t('Permissions')}</Label>
          {(['read', 'logs', 'exec'] as const).map((k) => (
            <label key={k} className="no-drag flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <span>
                <span className={cn('block', k === 'exec' && caps.exec && 'text-warn')}>{t(CAP_LABEL[k])}</span>
                <span className="block text-xs text-muted-foreground">
                  {k === 'read' && t('List servers, live status, problems')}
                  {k === 'logs' && t('Docker, PM2 and journal logs')}
                  {k === 'exec' && t('Shell commands over SSH, limited by your policy')}
                </span>
              </span>
              <Switch checked={caps[k]} onCheckedChange={(v) => setCaps({ ...caps, [k]: v })} />
            </label>
          ))}
        </div>

        <div className="grid gap-2">
          <Label>{t('Servers')}</Label>
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setAll(v)}
                className={cn(
                  'no-drag flex-1 rounded px-3 py-1 text-xs font-medium',
                  all === v ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {v ? t('All servers') : t('Selected servers')}
              </button>
            ))}
          </div>
          {!all && (
            <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-border p-2">
              {servers.length === 0 && <p className="px-1 text-xs text-muted-foreground">{t('No servers yet')}</p>}
              {servers.map((s) => (
                <label
                  key={s.id}
                  className="no-drag flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-secondary/60"
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(s.id)}
                    onChange={() => toggleServer(s.id)}
                    className="size-4 accent-[#c9c7c7]"
                  />
                  <span className="truncate">{s.name}</span>
                  <span className="truncate font-mono text-xs text-subtle">{s.host}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-bad">{t(error)}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => void save()}>
            {editing ? t('Save') : t('Create agent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- token shown once
function TokenDialog({ info, url, onClose }: { info: { name: string; token: string } | null; url: string; onClose: () => void }) {
  const t = useT()
  return (
    <Dialog open={!!info} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        {info && (
          <>
            <DialogHeader>
              <DialogTitle>{t('Token for {name}', { name: info.name })}</DialogTitle>
              <DialogDescription>
                {t('Copy it now. For your safety only a fingerprint is stored, so it cannot be shown again (you can generate a new one).')}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 select-text break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
                {info.token}
              </code>
              <CopyButton text={info.token} className="h-9" />
            </div>
            <Snippets url={url} token={info.token} />
            <DialogFooter>
              <Button onClick={onClose}>{t('I have copied it')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- list
export function McpAgents({ state, mcp, servers }: Props) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  const [editor, setEditor] = useState<{ open: boolean; agent: McpClientView | null }>({ open: false, agent: null })
  const [token, setToken] = useState<{ name: string; token: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const scopeText = (c: McpClientView): string =>
    c.servers === 'all'
      ? t('All servers')
      : c.servers.length === 0
        ? t('No servers')
        : servers
            .filter((s) => (c.servers as string[]).includes(s.id))
            .map((s) => s.name)
            .join(', ')

  const act = async (r: ReturnType<McpApi['deleteAgent']>): Promise<void> => {
    const res = await r
    setError(res.ok ? null : res.error)
    return
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('Agents that may connect. Disable or delete one to cut it off immediately.')}</p>
        <Button size="sm" onClick={() => setEditor({ open: true, agent: null })}>
          <Plus /> {t('Add agent')}
        </Button>
      </div>
      {error && <p className="rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">{t(error)}</p>}

      {state.clients.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <Bot className="size-8 text-subtle" />
          <div className="text-sm text-foreground">{t('No agents yet')}</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            {t('Create an agent to get a token you can give to Claude Code, Cursor or any MCP client.')}
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {state.clients.map((c) => {
            const live = isActive(c, now)
            return (
              <li key={c.id} className={cn('rounded-lg border border-border bg-card p-3', !c.enabled && 'opacity-60')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', live ? 'dot-live bg-ok' : 'bg-dim')}
                      title={live ? t('Connected') : t('Not connected')}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{c.name}</span>
                        {c.clientInfo && (
                          <span className="font-mono text-xs text-subtle">
                            {c.clientInfo.name} {c.clientInfo.version}
                          </span>
                        )}
                        {live && <Badge variant="ok">{t('Connected')}</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {(['read', 'logs', 'exec'] as const).map((k) => (
                          <Badge
                            key={k}
                            variant={c.caps[k] ? (k === 'exec' ? 'warn' : 'info') : 'outline'}
                            className={cn(!c.caps[k] && 'line-through opacity-60')}
                          >
                            {t(CAP_LABEL[k])}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-1.5 break-words text-xs text-muted-foreground">
                        {scopeText(c)} · {t('{n} calls', { n: c.calls })} · {t('last seen {t}', { t: relativeTime(c.lastSeen, now, t) })} ·{' '}
                        <span className="font-mono">{c.tokenPrefix}…</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={c.enabled}
                      onCheckedChange={(enabled) => void act(mcp.updateAgent(c.id, { enabled }))}
                      aria-label={t('Enabled')}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('Edit')}
                      aria-label={t('Edit')}
                      onClick={() => setEditor({ open: true, agent: c })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('Generate a new token')}
                      aria-label={t('Generate a new token')}
                      onClick={async () => {
                        if (
                          !window.confirm(t('Generate a new token for "{name}"? The old one stops working immediately.', { name: c.name }))
                        )
                          return
                        const r = await mcp.rotateToken(c.id)
                        if (r.ok && r.token) setToken({ name: c.name, token: r.token })
                        else if (!r.ok) setError(r.error)
                      }}
                    >
                      <KeyRound />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      title={t('Delete')}
                      aria-label={t('Delete')}
                      onClick={() => window.confirm(t('Delete agent "{name}"?', { name: c.name })) && void act(mcp.deleteAgent(c.id))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <AgentEditor
        open={editor.open}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
        editing={editor.agent}
        servers={servers}
        mcp={mcp}
        onToken={(name, tk) => setToken({ name, token: tk })}
      />
      <TokenDialog info={token} url={state.url} onClose={() => setToken(null)} />
    </div>
  )
}

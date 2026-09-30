import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { McpState } from '@shared/mcp'
import type { McpApi } from '@shared/types'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/lib/i18n'
import { claudeCodeCommand, jsonConfig } from '@/lib/mcp-client'
import { cn } from '@/lib/utils'

/** A titled, copyable block of text (commands, JSON). */
export function Snippet({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <CopyButton text={text} className="h-7 px-2" />
      </div>
      <pre className="select-text overflow-x-auto whitespace-pre rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 text-foreground">
        {text}
      </pre>
    </div>
  )
}

export function Snippets({ url, token }: { url: string; token: string }) {
  const t = useT()
  return (
    <div className="space-y-3">
      <Snippet title={t('Claude Code')} text={claudeCodeCommand(url, token)} />
      <Snippet title={t('JSON config (Cursor, Windsurf, others)')} text={jsonConfig(url, token)} />
    </div>
  )
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <section className={cn('rounded-lg border border-border bg-card p-4', className)}>{children}</section>
)

interface Props {
  state: McpState
  mcp: McpApi
}

export function McpOverview({ state, mcp }: Props) {
  const t = useT()
  const [port, setPort] = useState(String(state.port))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setPort(String(state.port)), [state.port])

  const run = async (fn: () => ReturnType<McpApi['setEnabled']>): Promise<void> => {
    setBusy(true)
    const r = await fn()
    setError(r.ok ? null : r.error)
    setBusy(false)
  }

  const active = state.enabled && state.listening
  const active_agents = state.clients.filter((c) => c.enabled).length

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className={cn('size-2.5 rounded-full', active ? 'dot-live bg-ok' : state.enabled ? 'bg-bad' : 'bg-dim')} />
              {active ? t('MCP server is running') : state.enabled ? t('MCP server could not start') : t('MCP server is off')}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {active
                ? t('Listening on {url}. {n} agent(s) configured.', { url: state.url, n: active_agents })
                : state.error
                  ? t(state.error)
                  : t('Agents such as Claude Code or Cursor can connect to your servers through this app.')}
            </p>
          </div>
          <label className="no-drag flex items-center gap-3 text-sm text-foreground">
            {t('Enable')}
            <Switch checked={state.enabled} disabled={busy} onCheckedChange={(on) => void run(() => mcp.setEnabled(on))} />
          </label>
        </div>
        {state.error && state.enabled && <p className="mt-3 rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">{t(state.error)}</p>}
        {error && <p className="mt-3 rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">{t(error)}</p>}
      </Card>

      <div className="flex gap-3 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm text-foreground">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn" />
        <div className="space-y-1.5">
          <div className="font-medium">{t('Give agents only the access they need')}</div>
          <p className="text-xs leading-5 text-muted-foreground">
            {t(
              'An agent can read your servers, and — if you allow it — run commands over your SSH connections. Commands are checked against your policy, can require your approval in a native dialog, and every call is logged. The endpoint is only reachable from this computer.'
            )}
          </p>
        </div>
      </div>

      <Card className="space-y-3">
        <div className="text-sm font-semibold text-foreground">{t('Endpoint')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 select-text truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
            {state.url}
          </code>
          <CopyButton text={state.url} className="h-9" />
          <Input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            aria-label={t('Port')}
            className="h-9 w-24 font-mono text-xs"
          />
          <Button
            variant="secondary"
            size="sm"
            className="h-9"
            disabled={busy || Number(port) === state.port}
            onClick={() => void run(() => mcp.setPort(Number(port)))}
          >
            {t('Apply')}
          </Button>
        </div>
        <p className="text-xs text-subtle">
          {t('Transport: Streamable HTTP · authentication: one bearer token per agent (create agents in the Agents tab).')}
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="text-sm font-semibold text-foreground">{t('Connect an agent')}</div>
        <p className="text-xs text-muted-foreground">
          {t('Create an agent to get its token, then use one of these. Replace <AGENT_TOKEN> with that token.')}
        </p>
        <Snippets url={state.url} token="<AGENT_TOKEN>" />
      </Card>
    </div>
  )
}

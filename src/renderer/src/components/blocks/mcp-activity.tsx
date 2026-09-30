import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import type { AuditDecision, AuditEntry } from '@shared/mcp'
import type { McpApi } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

const DECISION: Record<AuditDecision, { label: string; variant: 'ok' | 'info' | 'bad' | 'warn' | 'muted' | 'caution' }> = {
  ok: { label: 'Read', variant: 'muted' },
  allowed: { label: 'Allowed', variant: 'ok' },
  approved: { label: 'Approved by you', variant: 'info' },
  denied: { label: 'Refused', variant: 'bad' },
  rejected: { label: 'Rejected by you', variant: 'warn' },
  error: { label: 'Error', variant: 'caution' }
}

/** Everything agents did, newest first. Stored only on this computer. */
export function McpActivity({ mcp }: { mcp: McpApi }) {
  const { t, locale } = useI18n()
  const [rows, setRows] = useState<AuditEntry[] | null>(null)

  const load = useCallback(async () => setRows(await mcp.getAudit(300)), [mcp])
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 4000)
    return () => clearInterval(id)
  }, [load])

  const when = (ts: number): string => {
    const d = new Date(ts)
    const today = new Date().toDateString() === d.toDateString()
    return today ? d.toLocaleTimeString(locale) : `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale)}`
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t('Every call an agent makes, including refused ones. Stored only on this computer.')}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw /> {t('Refresh')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!rows?.length}
            onClick={async () => {
              if (!window.confirm(t('Clear the whole activity log?'))) return
              await mcp.clearAudit()
              await load()
            }}
          >
            <Trash2 /> {t('Clear')}
          </Button>
        </div>
      </div>

      {rows && rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {t('No activity yet')}
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="sticky top-0 bg-popover text-muted-foreground">
              <tr>
                {[t('Time'), t('Agent'), t('Tool'), t('Server'), t('Command / target'), t('Result')].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="select-text">
              {(rows ?? []).map((r, i) => (
                <tr key={`${r.ts}-${i}`} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{when(r.ts)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-foreground">{r.clientName}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">{r.tool}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.serverName ?? '–'}</td>
                  <td className="max-w-[320px] truncate px-3 py-1.5 font-mono" title={r.command}>
                    {r.command ?? '–'}
                  </td>
                  <td className="px-3 py-1.5" title={r.reason}>
                    <Badge variant={DECISION[r.decision].variant}>{t(DECISION[r.decision].label)}</Badge>
                    {r.exitCode !== undefined && r.exitCode !== null && r.exitCode !== 0 && (
                      <span className="ml-1.5 font-mono text-bad">exit {r.exitCode}</span>
                    )}
                    {r.reason && r.decision !== 'ok' && <div className="mt-0.5 max-w-[260px] truncate text-subtle">{r.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

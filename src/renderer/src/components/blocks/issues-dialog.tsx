import { CheckCircle2, FileText } from 'lucide-react'
import type { Issue } from '@shared/issues'
import { issueText } from '@shared/issues'
import type { LogKind, ServerInfo, ServerStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { StateDot } from './server-node'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  issues: Issue[]
  servers: ServerInfo[]
  statuses: Record<string, ServerStatus>
  onOpenServer: (id: string) => void
  onOpenLogs: (serverId: string, kind: LogKind, name: string) => void
}

const LOG_KIND: Partial<Record<Issue['kind'], LogKind>> = { docker: 'docker', pm2: 'pm2', service: 'service' }

/** Everything that is currently wrong, grouped by server, worst first. */
export function IssuesDialog({ open, onOpenChange, issues, servers, statuses, onOpenServer, onOpenLogs }: Props) {
  const { t, lang } = useI18n()
  const byServer = servers.map((s) => ({ s, list: issues.filter((i) => i.serverId === s.id) })).filter((g) => g.list.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <div>
          <DialogTitle>{t('Problems')}</DialogTitle>
          <DialogDescription>
            {issues.length ? t('{n} open', { n: issues.length }) : t('Nothing needs attention right now.')}
          </DialogDescription>
        </div>

        {byServer.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-ok">
            <CheckCircle2 className="size-10" />
            <span className="text-sm">{t('All systems healthy')}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {byServer.map(({ s, list }) => (
              <section key={s.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                    <StateDot status={statuses[s.id]} />
                    <span className="truncate">{s.name}</span>
                    <span className="truncate font-mono text-xs font-normal text-subtle">{s.host}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false)
                      onOpenServer(s.id)
                    }}
                  >
                    {t('Open')}
                  </Button>
                </header>
                <ul>
                  {list.map((i) => {
                    const kind = LOG_KIND[i.kind]
                    return (
                      <li key={i.id} className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0">
                        <span className={cn('size-2 shrink-0 rounded-full', i.severity === 'bad' ? 'bg-bad' : 'bg-warn')} />
                        <span className="min-w-0 flex-1 break-words text-sm text-foreground">{issueText(i, lang)}</span>
                        {kind && i.names?.[0] && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 shrink-0 gap-1.5 px-2"
                            onClick={() => onOpenLogs(i.serverId, kind, i.names![0])}
                          >
                            <FileText className="size-3.5" />
                            {t('Logs')}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

import { Activity, Box, Cog, Container, HardDrive, Network, Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ServerInfo, ServerStatus } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/lib/i18n'
import { COLORS, formatBytes, formatDuration, formatRate, formatUptime, pctText } from '@/lib/utils'
import { Bar, RingGauge, Sparkline } from './motion'
import { StateDot, diskSummary } from './server-node'

interface Props {
  info: ServerInfo | null
  status?: ServerStatus
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
}

const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0 rounded-lg border border-border bg-card p-3">
    <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
    <div className="mt-1 truncate text-sm text-foreground">{children}</div>
  </div>
)

const Empty = ({ children }: { children: ReactNode }) => <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>

/** Scrolls horizontally inside its own box instead of pushing the dialog wider; long cells are truncated. */
const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <div className="max-h-[46vh] overflow-auto rounded-lg border border-border">
    <table className="w-full min-w-max text-left text-xs">
      <thead className="sticky top-0 bg-popover text-muted-foreground">
        <tr>
          {head.map((h) => (
            <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="select-text">
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border">
            {r.map((c, j) => (
              <td
                key={j}
                className="max-w-[240px] truncate whitespace-nowrap px-3 py-1.5 font-mono"
                title={typeof c === 'string' ? c : undefined}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

export function ServerDetail({ info, status: s, onClose, onEdit, onDelete }: Props) {
  const { t, locale } = useI18n()
  const disk = diskSummary(s)
  const ring = { size: 84, stroke: 8 }
  return (
    <Dialog open={!!info} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" aria-describedby={undefined}>
        {info && (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <DialogTitle className="flex items-center gap-2 text-lg">
                    <StateDot status={s} /> <span className="truncate">{info.name}</span>
                  </DialogTitle>
                  <DialogDescription className="truncate font-mono text-xs">
                    {info.username}@{info.host}:{info.port}
                    {s?.hostname ? ` · ${s.hostname}` : ''}
                    {s?.kernel ? ` · kernel ${s.kernel}` : ''}
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 gap-1">
                  {onEdit && (
                    <Button variant="ghost" size="icon" onClick={onEdit} title={t('Edit')} aria-label={t('Edit')}>
                      <Pencil />
                    </Button>
                  )}
                  {onDelete && (
                    <Button variant="destructive" size="icon" onClick={onDelete} title={t('Delete')} aria-label={t('Delete')}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
            </DialogHeader>

            {!s || s.state !== 'online' ? (
              <Empty>
                {s?.state === 'offline' ? t('Offline — {reason}', { reason: s.error ? t(s.error) : t('no connection') }) : t('Connecting…')}
              </Empty>
            ) : (
              <Tabs defaultValue="overview" className="min-w-0">
                <TabsList>
                  <TabsTrigger value="overview">
                    <Activity className="size-3.5" /> {t('Overview')}
                  </TabsTrigger>
                  <TabsTrigger value="docker">
                    <Container className="size-3.5" /> Docker ({s.docker.available ? `${s.docker.running}/${s.docker.total}` : '–'})
                  </TabsTrigger>
                  <TabsTrigger value="pm2">
                    <Box className="size-3.5" /> PM2 ({s.pm2.available ? `${s.pm2.online}/${s.pm2.total}` : '–'})
                  </TabsTrigger>
                  <TabsTrigger value="services">
                    <Cog className="size-3.5" /> {t('Services')} ({s.services.running.length})
                  </TabsTrigger>
                  <TabsTrigger value="ports">
                    <Network className="size-3.5" /> {t('Ports')} ({s.ports.length})
                  </TabsTrigger>
                  <TabsTrigger value="disks">
                    <HardDrive className="size-3.5" /> {t('Disks')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="flex flex-wrap items-start justify-around gap-x-4 gap-y-3 rounded-lg border border-border bg-card py-4">
                    <RingGauge {...ring} value={s.cpu} label="CPU" sub={`${s.cores} ${t('cores')}`} />
                    <RingGauge {...ring} value={s.memPct} label="RAM" sub={`${formatBytes(s.memUsed)} / ${formatBytes(s.memTotal, 0)}`} />
                    <RingGauge {...ring} value={disk.pct} label={t('Disk')} sub={disk.sub} />
                    <RingGauge
                      {...ring}
                      value={s.swapTotal ? (s.swapUsed / s.swapTotal) * 100 : 0}
                      label="Swap"
                      sub={s.swapTotal ? formatBytes(s.swapTotal, 0) : t('none')}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('CPU (recent)')}</div>
                      <Sparkline values={s.cpuHistory} color={COLORS.info} height={48} />
                    </div>
                    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('RAM (recent)')}</div>
                      <Sparkline values={s.memHistory} color={COLORS.ok} height={48} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label={t('Uptime')}>{formatUptime(s.uptimeSec)}</Stat>
                    <Stat label={t('Load (1/5/15)')}>
                      <span className="font-mono text-xs">{s.load.map((l) => l.toFixed(2)).join(' / ')}</span>
                    </Stat>
                    <Stat label={t('Network')}>
                      <span className="font-mono text-xs">
                        ↓ {formatRate(s.netRx)}
                        <br />↑ {formatRate(s.netTx)}
                      </span>
                    </Stat>
                    <Stat label={t('Latency')}>{s.latencyMs} ms</Stat>
                    <Stat label={t('Availability 24h')}>{pctText(s.availability.pct24h)}</Stat>
                    <Stat label={t('7 days')}>{pctText(s.availability.pct7d)}</Stat>
                    <Stat label={t('30 days')}>{pctText(s.availability.pct30d)}</Stat>
                    <Stat label={t('Outages (24h)')}>{s.availability.incidents24h}</Stat>
                  </div>
                  <p className="break-words text-[11px] text-dim">
                    {t('Availability is only measured while this app is running (since {date}).', {
                      date: new Date(s.availability.trackedSince).toLocaleDateString(locale)
                    })}{' '}
                    {s.os}
                  </p>
                </TabsContent>

                <TabsContent value="docker">
                  {!s.docker.available ? (
                    <Empty>{t('Docker not found, or this user cannot access it (docker group / root may be required).')}</Empty>
                  ) : (
                    <Table
                      head={[t('Container'), t('Image'), t('Status')]}
                      rows={s.docker.containers.map((c) => [
                        c.name,
                        c.image,
                        <Badge key={c.name} variant={c.state === 'running' ? 'ok' : c.state === 'restarting' ? 'warn' : 'bad'}>
                          {c.status}
                        </Badge>
                      ])}
                    />
                  )}
                </TabsContent>

                <TabsContent value="pm2">
                  {!s.pm2.available ? (
                    <Empty>{t('PM2 not found.')}</Empty>
                  ) : !s.pm2.daemon ? (
                    <Empty>{t('PM2 is installed but its daemon is not running for this user.')}</Empty>
                  ) : (
                    <Table
                      head={[t('Name'), t('Status'), 'CPU', t('Memory'), t('Restarts'), t('Age')]}
                      rows={s.pm2.procs.map((p) => [
                        p.name,
                        <Badge key={p.name} variant={p.status === 'online' ? 'ok' : 'bad'}>
                          {p.status}
                        </Badge>,
                        `${p.cpu}%`,
                        formatBytes(p.memory),
                        p.restarts,
                        p.uptimeMs ? formatDuration(p.uptimeMs) : '–'
                      ])}
                    />
                  )}
                </TabsContent>

                <TabsContent value="services" className="space-y-3">
                  {!s.services.available ? (
                    <Empty>{t('systemd not found.')}</Empty>
                  ) : (
                    <>
                      {s.services.failed.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 rounded-lg bg-bad/10 p-3">
                          <span className="mr-1 text-xs text-bad">{t('Failed:')}</span>
                          {s.services.failed.map((f) => (
                            <Badge key={f} variant="bad">
                              {f}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex max-h-[40vh] select-text flex-wrap gap-1.5 overflow-auto">
                        {s.services.running.map((f) => (
                          <Badge key={f} variant="muted" className="font-mono">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="ports">
                  {s.ports.length === 0 ? (
                    <Empty>{t('No listening ports found (ss/netstat may be missing).')}</Empty>
                  ) : (
                    <Table
                      head={[t('Port'), t('Proto'), t('Exposure'), t('Process')]}
                      rows={s.ports.map((p) => [
                        p.port,
                        p.proto,
                        <Badge key={`${p.proto}${p.port}`} variant={p.exposure === 'public' ? 'warn' : 'muted'}>
                          {p.exposure === 'public' ? t('public') : t('local')}
                        </Badge>,
                        p.process ?? '–'
                      ])}
                    />
                  )}
                </TabsContent>

                <TabsContent value="disks" className="space-y-3">
                  {s.disks.map((d) => (
                    <div key={d.mount} className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-2 flex flex-wrap justify-between gap-x-3 text-xs">
                        <span className="min-w-0 truncate font-mono text-foreground">
                          {d.mount} <span className="text-dim">{d.fs}</span>
                        </span>
                        <span className="text-muted-foreground">
                          {formatBytes(d.used)} / {formatBytes(d.size)} · {d.pct.toFixed(0)}%
                        </span>
                      </div>
                      <Bar value={d.pct} />
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

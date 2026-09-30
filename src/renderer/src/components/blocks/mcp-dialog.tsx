import { Activity, Bot, Plug, ShieldCheck } from 'lucide-react'
import type { McpState } from '@shared/mcp'
import type { McpApi, ServerInfo } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/lib/i18n'
import { McpActivity } from './mcp-activity'
import { McpAgents } from './mcp-agents'
import { McpOverview } from './mcp-overview'
import { McpPolicy } from './mcp-policy'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  state: McpState | null
  mcp: McpApi
  servers: ServerInfo[]
}

/** Agent (MCP) access: on/off, who may connect, what they may do, and what they did. */
export function McpDialog({ open, onOpenChange, state, mcp, servers }: Props) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[88vh] max-w-4xl grid-rows-[auto_minmax(0,1fr)] gap-3" aria-describedby={undefined}>
        <div className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Plug className="size-5" /> {t('Agents (MCP)')}
          </DialogTitle>
          <DialogDescription>
            {t('Let AI agents look at your servers and, if you allow it, run commands, under rules you control.')}
          </DialogDescription>
        </div>

        {!state ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('Loading…')}</p>
        ) : (
          <Tabs defaultValue="overview" className="flex min-h-0 min-w-0 flex-col">
            <TabsList>
              <TabsTrigger value="overview">
                <Plug className="size-3.5" /> {t('Overview')}
              </TabsTrigger>
              <TabsTrigger value="agents">
                <Bot className="size-3.5" /> {t('Agents')} ({state.clients.length})
              </TabsTrigger>
              <TabsTrigger value="policy">
                <ShieldCheck className="size-3.5" /> {t('Policy')}
              </TabsTrigger>
              <TabsTrigger value="activity">
                <Activity className="size-3.5" /> {t('Activity')}
              </TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
              <TabsContent value="overview">
                <McpOverview state={state} mcp={mcp} />
              </TabsContent>
              <TabsContent value="agents">
                <McpAgents state={state} mcp={mcp} servers={servers} />
              </TabsContent>
              <TabsContent value="policy">
                <McpPolicy state={state} mcp={mcp} />
              </TabsContent>
              <TabsContent value="activity">
                <McpActivity mcp={mcp} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

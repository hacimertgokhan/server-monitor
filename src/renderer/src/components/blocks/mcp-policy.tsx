import { useEffect, useMemo, useState } from 'react'
import { Ban, Hand, ListChecks, ListX, Lock } from 'lucide-react'
import {
  DEFAULT_ALLOW,
  DEFAULT_DENY,
  HARD_DENY,
  OUTPUT_RANGE,
  TIMEOUT_RANGE,
  evaluateCommand,
  validateRule,
  verdictText
} from '@shared/mcp'
import type { ExecMode, McpState, Policy } from '@shared/mcp'
import type { McpApi } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Card } from './mcp-overview'

const MODES: { id: ExecMode; icon: typeof Ban; title: string; text: string }[] = [
  {
    id: 'ask',
    icon: Hand,
    title: 'Ask me',
    text: 'Every command waits for your approval in a native dialog. Commands on the allow list run immediately (optional).'
  },
  {
    id: 'whitelist',
    icon: ListChecks,
    title: 'Allow list only',
    text: 'Only commands that match the allow list may run; everything else is refused. Shell tricks (substitution, redirects) are refused too.'
  },
  {
    id: 'blacklist',
    icon: ListX,
    title: 'Deny list',
    text: 'Anything may run unless it matches the deny list. Convenient, but a deny list can never be complete.'
  },
  { id: 'off', icon: Lock, title: 'No commands', text: 'Agents can read status and logs but can never run commands.' }
]

const lines = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

function RuleEditor({
  label,
  hint,
  value,
  onChange,
  onReset
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  onReset: () => void
}) {
  const { t } = useI18n()
  const list = lines(value)
  const bad = list.filter((l) => validateRule(l))
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          {label} <span className="font-mono text-xs font-normal text-subtle">{list.length}</span>
        </span>
        <button
          type="button"
          onClick={onReset}
          className="no-drag text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t('Restore defaults')}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={9}
        className="no-drag block w-full select-text resize-y rounded-md border border-input bg-background p-2.5 font-mono text-xs leading-5 text-foreground focus-visible:border-ring focus-visible:outline-none"
      />
      <p className="text-xs text-subtle">{hint}</p>
      {bad.length > 0 && (
        <p className="text-xs text-bad">{t('Ignored (invalid): {rules}', { rules: bad.map((b) => b.slice(0, 40)).join(' · ') })}</p>
      )}
    </div>
  )
}

const Number = ({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
}) => (
  <label className="no-drag flex items-center justify-between gap-3 text-sm text-foreground">
    {label}
    <Input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(e.target.valueAsNumber || min)}
      className="h-8 w-24 font-mono text-xs"
    />
  </label>
)

export function McpPolicy({ state, mcp }: { state: McpState; mcp: McpApi }) {
  const { t, lang } = useI18n()
  const [draft, setDraft] = useState<Policy>(state.policy)
  const [denyText, setDenyText] = useState(state.policy.deny.join('\n'))
  const [allowText, setAllowText] = useState(state.policy.allow.join('\n'))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState('docker restart web')

  const effective: Policy = useMemo(() => ({ ...draft, deny: lines(denyText), allow: lines(allowText) }), [draft, denyText, allowText])
  const dirty = JSON.stringify(effective) !== JSON.stringify(state.policy)

  // adopt changes made elsewhere, but never overwrite what the user is editing
  useEffect(() => {
    if (dirty) return
    setDraft(state.policy)
    setDenyText(state.policy.deny.join('\n'))
    setAllowText(state.policy.allow.join('\n'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.policy])

  const save = async (): Promise<void> => {
    const r = await mcp.setPolicy(effective)
    setError(r.ok ? null : r.error)
    if (r.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const verdict = probe.trim() ? evaluateCommand(probe, effective) : null

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map(({ id, icon: Icon, title, text }) => {
          const on = draft.mode === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setDraft({ ...draft, mode: id })}
              className={cn(
                'no-drag flex gap-3 rounded-lg border p-3 text-left transition-colors',
                on ? 'border-foreground/50 bg-secondary' : 'border-border bg-card hover:border-dim'
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  on ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                )}
              >
                <Icon className="size-4.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{t(title)}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{t(text)}</span>
              </span>
            </button>
          )
        })}
      </div>

      {draft.mode === 'blacklist' && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {t('A deny list can be bypassed (encoded commands, scripts, aliases). For real safety use "Ask me" or "Allow list only".')}
        </p>
      )}

      <Card className="grid gap-3 sm:grid-cols-2">
        <label className="no-drag flex items-center justify-between gap-3 text-sm text-foreground sm:col-span-2">
          <span>
            {t('Run allow-listed commands without asking')}
            <span className="block text-xs text-muted-foreground">
              {t('In "Ask me" mode: safe diagnostics run immediately, everything else asks.')}
            </span>
          </span>
          <Switch checked={draft.autoAllowSafe} onCheckedChange={(v) => setDraft({ ...draft, autoAllowSafe: v })} />
        </label>
        <label className="no-drag flex items-center justify-between gap-3 text-sm text-foreground sm:col-span-2">
          <span>
            {t('Allow pipes and command chaining')}
            <span className="block text-xs text-muted-foreground">{t('a | b, a && b, a ; b are allowed when every part is allowed.')}</span>
          </span>
          <Switch checked={draft.allowChaining} onCheckedChange={(v) => setDraft({ ...draft, allowChaining: v })} />
        </label>
        <Number
          label={t('Timeout (seconds)')}
          value={draft.timeoutSec}
          min={TIMEOUT_RANGE.min}
          max={TIMEOUT_RANGE.max}
          onChange={(n) => setDraft({ ...draft, timeoutSec: n })}
        />
        <Number
          label={t('Max output (KB)')}
          value={draft.maxOutputKb}
          min={OUTPUT_RANGE.min}
          max={OUTPUT_RANGE.max}
          onChange={(n) => setDraft({ ...draft, maxOutputKb: n })}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <RuleEditor
          label={t('Deny list')}
          hint={t('One rule per line. Plain text matches anywhere in the command; * is a wildcard; /regex/ is a regular expression.')}
          value={denyText}
          onChange={setDenyText}
          onReset={() => setDenyText(DEFAULT_DENY.join('\n'))}
        />
        <RuleEditor
          label={t('Allow list')}
          hint={t(
            'One rule per line. Plain text must match the start of a command (docker ps matches docker ps -a, not docker psx); * and /regex/ work too.'
          )}
          value={allowText}
          onChange={setAllowText}
          onReset={() => setAllowText(DEFAULT_ALLOW.join('\n'))}
        />
      </div>

      <Card className="space-y-2">
        <div className="text-sm font-semibold text-foreground">{t('Always blocked (built in, cannot be changed)')}</div>
        <div className="flex flex-wrap gap-1.5">
          {HARD_DENY.map((h) => (
            <Badge key={h.id} variant="bad">
              {h.id}
            </Badge>
          ))}
        </div>
      </Card>

      <Card className="space-y-2">
        <div className="text-sm font-semibold text-foreground">{t('Test a command')}</div>
        <p className="text-xs text-muted-foreground">
          {t('See what would happen with the rules above (including unsaved edits). Nothing is executed.')}
        </p>
        <Input
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder="docker ps -a"
          spellCheck={false}
          className="h-9 font-mono text-xs"
        />
        {verdict && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={verdict.decision === 'allow' ? 'ok' : verdict.decision === 'ask' ? 'caution' : 'bad'}>
              {verdict.decision === 'allow' ? t('Allowed') : verdict.decision === 'ask' ? t('Asks you') : t('Refused')}
            </Badge>
            <span className="text-muted-foreground">{verdictText(verdict, lang)}</span>
          </div>
        )}
      </Card>

      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-border bg-popover px-1 py-3">
        {error && <span className="text-xs text-bad">{t(error)}</span>}
        {saved && <span className="text-xs text-ok">{t('Saved')}</span>}
        {dirty && <span className="text-xs text-caution">{t('Unsaved changes')}</span>}
        <Button
          variant="outline"
          disabled={!dirty}
          onClick={() => {
            setDraft(state.policy)
            setDenyText(state.policy.deny.join('\n'))
            setAllowText(state.policy.allow.join('\n'))
          }}
        >
          {t('Revert')}
        </Button>
        <Button disabled={!dirty} onClick={() => void save()}>
          {t('Save policy')}
        </Button>
      </div>
    </div>
  )
}

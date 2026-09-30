/**
 * MCP (Model Context Protocol) access control: types shared by the main process and the UI, plus the pure command
 * policy engine. Nothing here touches the network or the disk, so it is easy to test exhaustively.
 */

export type ExecMode = 'off' | 'ask' | 'whitelist' | 'blacklist'

export interface Policy {
  mode: ExecMode
  /** Commands matching any of these are refused in every mode. */
  deny: string[]
  /** "whitelist": only these may run. "ask": these run without asking (when autoAllowSafe is on). */
  allow: string[]
  /** In "ask" mode, run allow-listed commands immediately instead of prompting. */
  autoAllowSafe: boolean
  /** "whitelist" mode: allow `a | b`, `a && b`, `a ; b` when every part is allowed. */
  allowChaining: boolean
  timeoutSec: number
  maxOutputKb: number
}

export interface Capabilities {
  /** list_servers, get_server_status, list_issues */
  read: boolean
  /** get_logs (docker / pm2 / journal) */
  logs: boolean
  /** run_command (still subject to the policy) */
  exec: boolean
}

export interface McpClientView {
  id: string
  name: string
  /** First characters of the token, to tell agents apart. The full token is only shown when created. */
  tokenPrefix: string
  createdAt: number
  enabled: boolean
  /** 'all', or the ids of the servers this agent may use. */
  servers: 'all' | string[]
  caps: Capabilities
  lastSeen?: number
  calls: number
  clientInfo?: { name: string; version: string }
}

export interface McpState {
  enabled: boolean
  port: number
  listening: boolean
  error?: string
  url: string
  clients: McpClientView[]
  policy: Policy
}

export type AuditDecision = 'ok' | 'allowed' | 'approved' | 'denied' | 'rejected' | 'error'

export interface AuditEntry {
  ts: number
  clientId: string
  clientName: string
  tool: string
  serverId?: string
  serverName?: string
  command?: string
  decision: AuditDecision
  reason?: string
  exitCode?: number | null
  ms?: number
}

export interface NewClientInput {
  name: string
  servers: 'all' | string[]
  caps: Capabilities
}

export const DEFAULT_PORT = 8765
export const DEFAULT_CAPS: Capabilities = { read: true, logs: true, exec: false }

export const MAX_COMMAND_LENGTH = 4000
export const MAX_RULES = 200
export const MAX_RULE_LENGTH = 300
export const TIMEOUT_RANGE = { min: 1, max: 600 } as const
export const OUTPUT_RANGE = { min: 1, max: 2000 } as const

// ---------------------------------------------------------------- rule lists
/**
 * Rule syntax (one per line):
 *   plain text   `docker ps`      allow: the command starts with it · deny: the command contains it
 *   glob         `docker logs *`  `*` matches anything, `?` one character (allow: whole segment · deny: contains)
 *   regex        `/^ping -c \d+ \S+$/i`
 */
export const DEFAULT_DENY: string[] = [
  'rm -rf',
  'rm -fr',
  'reboot',
  'shutdown',
  'poweroff',
  'halt',
  'init 0',
  'init 6',
  'systemctl stop',
  'systemctl disable',
  'systemctl mask',
  'kill -9',
  'killall',
  'pkill',
  'iptables -F',
  'ufw disable',
  'passwd',
  'userdel',
  'usermod',
  'visudo',
  'crontab -r',
  'chmod -R',
  'chown -R',
  'truncate',
  'history -c',
  'docker rm',
  'docker rmi',
  'docker system prune',
  'docker volume rm',
  '/(curl|wget)[^|;]*\\|\\s*(sudo\\s+)?(ba|z)?sh/i'
]

/** Read-only diagnostics. Risky commands use precise regexes so that arguments cannot change their meaning. */
export const DEFAULT_ALLOW: string[] = [
  'uptime',
  'whoami',
  'uname',
  'id',
  'df',
  'du',
  'free',
  'lscpu',
  'lsblk',
  'vmstat',
  'ps',
  'pgrep',
  'ss',
  'netstat',
  'w',
  'who',
  'last',
  'ls',
  '/^date(\\s+\\+\\S+)?$/',
  '/^hostname(\\s+-\\w+)?$/',
  '/^ip\\s+(-\\S+\\s+)*(a|addr|address|link|route|r)(\\s+show)?$/',
  '/^ping\\s+-c\\s*\\d{1,2}\\s+\\S+$/',
  'dig',
  'nslookup',
  'systemctl status',
  'systemctl is-active',
  'systemctl is-enabled',
  'systemctl list-units',
  'systemctl list-timers',
  'systemctl list-unit-files',
  '/^journalctl\\b(?!.*--(vacuum|rotate|flush|sync|setup-keys|relinquish))/',
  'docker ps',
  'docker images',
  'docker logs',
  'docker inspect',
  'docker top',
  'docker stats --no-stream',
  'docker compose ps',
  'docker compose logs',
  'pm2 list',
  'pm2 ls',
  'pm2 jlist',
  'pm2 status',
  'pm2 describe',
  'pm2 show',
  'pm2 logs --nostream',
  'nginx -t',
  'ufw status',
  'iptables -L',
  'crontab -l',
  'lsof -i',
  'dpkg -l',
  'apt list'
]

export const DEFAULT_POLICY: Policy = {
  mode: 'ask',
  deny: DEFAULT_DENY,
  allow: DEFAULT_ALLOW,
  autoAllowSafe: true,
  allowChaining: true,
  timeoutSec: 60,
  maxOutputKb: 200
}

/**
 * Refused in EVERY mode and not editable: irreversible disk / system destruction that no agent needs.
 * Matched against the lower-cased command with quotes and backslashes removed.
 */
export const HARD_DENY: { id: string; re: RegExp }[] = [
  { id: 'fork bomb', re: /:\s*\(\s*\)\s*\{.*:\s*\|\s*:/ },
  { id: 'mkfs', re: /\bmkfs(\.\w+)?\b/ },
  { id: 'dd to a device', re: /\bdd\b[^|;&]*\bof=\/dev\// },
  { id: 'write to a raw disk', re: />\s*\/dev\/(sd|nvme|vd|xvd|hd|mmcblk)/ },
  { id: 'rm on /, ~ or *', re: /\brm\b[^|;&]*\s(\/|\/\*|~|~\/|\*|\$home)([\s)`;&|]|$)/ },
  { id: 'rm --no-preserve-root', re: /\brm\b[^|;&]*--no-preserve-root/ },
  { id: 'recursive chmod/chown on /', re: /\b(chmod|chown)\b[^|;&]*\s-r[^|;&]*\s\/([\s)`;&|]|$)/ },
  { id: 'disk wiping tool', re: /\b(wipefs|shred|fdisk|sfdisk|parted|cfdisk|blkdiscard)\b/ },
  { id: 'cryptsetup destroy', re: /\bcryptsetup\s+(luksformat|erase|luksaddkey|luksremovekey)/ }
]

// ---------------------------------------------------------------- shell splitting
export interface ShellParts {
  /** Commands separated by `;` `&&` `||` `|` (quotes respected). */
  segments: string[]
  /** Shell features a text policy cannot verify (command substitution, redirects, background jobs, ...). */
  complex: string[]
  hasPipe: boolean
  hasChain: boolean
  unbalancedQuotes: boolean
}

const SAFE_REDIRECTS = /\s(2>&1|1>&2|>\/dev\/null|2>\/dev\/null|&>\/dev\/null|<\/dev\/null)(?=\s|$)/g

/** Splits a command line into segments while watching for constructs that make it unverifiable. */
export function splitShell(input: string): ShellParts {
  // harmless redirections are removed first so `cmd 2>&1` is not flagged
  const cmd = ` ${input.trim()} `.replace(SAFE_REDIRECTS, ' ').trim()
  const complex = new Set<string>()
  const segments: string[] = []
  let cur = ''
  let quote: '' | "'" | '"' = ''
  let hasPipe = false
  let hasChain = false
  const push = (): void => {
    if (cur.trim()) segments.push(cur.trim())
    cur = ''
  }

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    const n = cmd[i + 1]
    if (quote === "'") {
      if (c === "'") quote = ''
      cur += c
      continue
    }
    if (quote === '"') {
      if (c === '\\' && n !== undefined) {
        cur += c + n
        i++
        continue
      }
      if (c === '"') quote = ''
      else if (c === '`' || (c === '$' && (n === '(' || n === '{'))) complex.add('command substitution')
      cur += c
      continue
    }
    // ---- outside quotes
    if (c === '\\') {
      if (n === '\n') complex.add('line continuation')
      cur += c + (n ?? '')
      i++
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
      continue
    }
    if (c === '`') complex.add('command substitution')
    if (c === '$' && (n === '(' || n === '{' || n === "'" || n === '"'))
      complex.add(n === '(' || n === '{' ? 'command substitution' : 'ANSI-C quoting')
    if ((c === '<' || c === '>') && n === '(') complex.add('process substitution')
    if (c === '>' || c === '<') complex.add('redirection')
    if (c === '\n' || c === '\r') {
      complex.add('multiple lines')
      hasChain = true
      push()
      continue
    }
    if (c === ';') {
      hasChain = true
      push()
      continue
    }
    if (c === '&') {
      if (n === '&') {
        hasChain = true
        i++
        push()
      } else {
        complex.add('background job')
        push()
      }
      continue
    }
    if (c === '|') {
      if (n === '|') {
        hasChain = true
        i++
      } else hasPipe = true
      push()
      continue
    }
    cur += c
  }
  push()
  return { segments, complex: [...complex], hasPipe, hasChain, unbalancedQuotes: quote !== '' }
}

// ---------------------------------------------------------------- rule matching
/** Lower-case, drop quotes/backslashes, collapse whitespace: defeats `r""m -rf` style padding. */
export const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/["'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const REGEX_RULE = /^\/(.+)\/([a-z]*)$/s

/** Returns an error message for an unusable rule, or null. */
export function validateRule(rule: string): string | null {
  if (!rule.trim()) return 'empty'
  if (rule.length > MAX_RULE_LENGTH) return 'too long'
  const m = REGEX_RULE.exec(rule.trim())
  if (m) {
    try {
      new RegExp(m[1], m[2])
    } catch {
      return 'invalid regular expression'
    }
  }
  return null
}

const escapeRe = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')

type Matcher = (segment: string) => boolean

function compileRule(rule: string, role: 'allow' | 'deny'): Matcher {
  const raw = rule.trim()
  const m = REGEX_RULE.exec(raw)
  if (m) {
    let re: RegExp
    try {
      re = new RegExp(m[1], m[2])
    } catch {
      return () => false // an invalid rule never matches; the UI flags it
    }
    return (seg) => re.test(seg) || re.test(normalize(seg))
  }
  const body = normalize(raw)
  if (!body) return () => false
  const glob = /[*?]/.test(body)
  // glob -> regex source, character by character (`*` = anything, `?` = one character)
  const src = [...body].map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : escapeRe(ch))).join('')
  if (role === 'deny') {
    const re = new RegExp(glob ? src : escapeRe(body))
    return (seg) => re.test(normalize(seg))
  }
  // allow: whole-segment glob, or "starts with, at a word boundary" for plain text
  const re = glob ? new RegExp(`^${src}$`) : new RegExp(`^${escapeRe(body)}(?:\\s|$)`)
  return (seg) => re.test(normalize(seg))
}

const compileAll = (rules: string[], role: 'allow' | 'deny'): { rule: string; test: Matcher }[] =>
  rules.filter((r) => !validateRule(r)).map((rule) => ({ rule, test: compileRule(rule, role) }))

// ---------------------------------------------------------------- verdict
export type VerdictCode =
  | 'empty'
  | 'too-long'
  | 'mode-off'
  | 'hard-deny'
  | 'deny-rule'
  | 'unbalanced-quotes'
  | 'complex'
  | 'chaining'
  | 'traversal'
  | 'not-allowed'
  | 'ask'
  | 'allow-safe'
  | 'allow'

export interface Verdict {
  decision: 'allow' | 'deny' | 'ask'
  code: VerdictCode
  /** The rule, feature or command part the decision is about. */
  detail?: string
  segments: string[]
}

const verdict = (decision: Verdict['decision'], code: VerdictCode, segments: string[], detail?: string): Verdict => ({
  decision,
  code,
  detail,
  segments
})

/** Decides what may happen with a command line. `ask` means: the user must approve this exact command. */
export function evaluateCommand(command: string, policy: Policy): Verdict {
  const cmd = command.trim()
  if (!cmd) return verdict('deny', 'empty', [])
  if (cmd.length > MAX_COMMAND_LENGTH) return verdict('deny', 'too-long', [])
  if (policy.mode === 'off') return verdict('deny', 'mode-off', [])

  const parts = splitShell(cmd)
  const { segments } = parts
  if (parts.unbalancedQuotes) return verdict('deny', 'unbalanced-quotes', segments)

  // hard limits first: not editable, every mode
  const texts = [cmd, ...segments]
  for (const t of texts) {
    const n = normalize(t)
    for (const h of HARD_DENY) if (h.re.test(n)) return verdict('deny', 'hard-deny', segments, h.id)
  }
  for (const d of compileAll(policy.deny, 'deny')) {
    for (const t of texts) if (d.test(t)) return verdict('deny', 'deny-rule', segments, d.rule)
  }

  const allow = compileAll(policy.allow, 'allow')
  const allSegmentsAllowed = (): { ok: boolean; bad?: string } => {
    for (const s of segments) if (!allow.some((a) => a.test(s))) return { ok: false, bad: s }
    return { ok: true }
  }
  const traversal = segments.find((s) => /(^|[\s/])\.\.(\/|\s|$)/.test(s))

  if (policy.mode === 'blacklist') return verdict('allow', 'allow', segments)

  if (policy.mode === 'whitelist') {
    if (parts.complex.length) return verdict('deny', 'complex', segments, parts.complex[0])
    if ((parts.hasPipe || parts.hasChain) && !policy.allowChaining) return verdict('deny', 'chaining', segments)
    if (traversal) return verdict('deny', 'traversal', segments, traversal)
    const r = allSegmentsAllowed()
    return r.ok ? verdict('allow', 'allow', segments) : verdict('deny', 'not-allowed', segments, r.bad)
  }

  // ask
  if (policy.autoAllowSafe && !parts.complex.length && !traversal && (!parts.hasChain && !parts.hasPipe ? true : policy.allowChaining)) {
    if (allSegmentsAllowed().ok) return verdict('allow', 'allow-safe', segments)
  }
  return verdict('ask', 'ask', segments, parts.complex[0])
}

// ---------------------------------------------------------------- human-readable text (both languages)
export type VerdictLang = 'en' | 'tr'

const VERDICT_TEXT: Record<VerdictLang, Record<VerdictCode, (d?: string) => string>> = {
  en: {
    empty: () => 'Empty command',
    'too-long': () => `Command is longer than ${MAX_COMMAND_LENGTH} characters`,
    'mode-off': () => 'Command execution is disabled',
    'hard-deny': (d) => `Blocked by a built-in safety rule (${d})`,
    'deny-rule': (d) => `Blocked by the deny list: ${d}`,
    'unbalanced-quotes': () => 'Unbalanced quotes',
    complex: (d) => `Uses shell features the allow list cannot verify (${d})`,
    chaining: () => 'Pipes and command chaining are not allowed',
    traversal: (d) => `Path traversal (..) is not allowed: ${d}`,
    'not-allowed': (d) => `Not on the allow list: ${d}`,
    ask: () => 'Needs your approval',
    'allow-safe': () => 'Allowed automatically (matches the allow list)',
    allow: () => 'Allowed'
  },
  tr: {
    empty: () => 'Boş komut',
    'too-long': () => `Komut ${MAX_COMMAND_LENGTH} karakterden uzun`,
    'mode-off': () => 'Komut çalıştırma kapalı',
    'hard-deny': (d) => `Yerleşik güvenlik kuralı engelledi (${d})`,
    'deny-rule': (d) => `Kara liste engelledi: ${d}`,
    'unbalanced-quotes': () => 'Tırnaklar eşleşmiyor',
    complex: (d) => `İzin listesinin doğrulayamadığı kabuk özellikleri kullanıyor (${d})`,
    chaining: () => 'Boru (pipe) ve komut zincirleme kapalı',
    traversal: (d) => `Yol atlama (..) kabul edilmiyor: ${d}`,
    'not-allowed': (d) => `İzin listesinde yok: ${d}`,
    ask: () => 'Onayınız gerekiyor',
    'allow-safe': () => 'Otomatik izin verildi (izin listesiyle eşleşiyor)',
    allow: () => 'İzin verildi'
  }
}

export const verdictText = (v: Verdict, lang: VerdictLang): string => VERDICT_TEXT[lang][v.code](v.detail)

/** Plain-English reason for logs and MCP error results (agents read English). */
export const verdictReason = (v: Verdict): string => VERDICT_TEXT.en[v.code](v.detail)

// ---------------------------------------------------------------- sanitising untrusted input
const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fallback
  return Math.max(lo, Math.min(hi, v))
}

const cleanRules = (rules: unknown): string[] => {
  if (!Array.isArray(rules)) return []
  const out: string[] = []
  for (const r of rules) {
    if (typeof r !== 'string') continue
    const t = r.trim()
    if (t && !validateRule(t) && !out.includes(t)) out.push(t)
    if (out.length >= MAX_RULES) break
  }
  return out
}

/** Makes any input a valid Policy (used for everything that arrives over IPC or from disk). */
export function sanitizePolicy(input: unknown): Policy {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<Policy>
  const modes: ExecMode[] = ['off', 'ask', 'whitelist', 'blacklist']
  return {
    mode: modes.includes(p.mode as ExecMode) ? (p.mode as ExecMode) : DEFAULT_POLICY.mode,
    deny: Array.isArray(p.deny) ? cleanRules(p.deny) : [...DEFAULT_DENY],
    allow: Array.isArray(p.allow) ? cleanRules(p.allow) : [...DEFAULT_ALLOW],
    autoAllowSafe: typeof p.autoAllowSafe === 'boolean' ? p.autoAllowSafe : DEFAULT_POLICY.autoAllowSafe,
    allowChaining: typeof p.allowChaining === 'boolean' ? p.allowChaining : DEFAULT_POLICY.allowChaining,
    timeoutSec: clamp(p.timeoutSec, TIMEOUT_RANGE.min, TIMEOUT_RANGE.max, DEFAULT_POLICY.timeoutSec),
    maxOutputKb: clamp(p.maxOutputKb, OUTPUT_RANGE.min, OUTPUT_RANGE.max, DEFAULT_POLICY.maxOutputKb)
  }
}

export function sanitizeCaps(input: unknown): Capabilities {
  const c = (input && typeof input === 'object' ? input : {}) as Partial<Capabilities>
  return { read: c.read !== false, logs: c.logs !== false, exec: c.exec === true }
}

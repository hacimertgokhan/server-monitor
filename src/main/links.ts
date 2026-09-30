/** Links the renderer may ask us to open. Anything else is refused (the renderer is untrusted input). */
const ALLOWED_HOSTS = new Set(['hacimertgokhan.com', 'www.hacimertgokhan.com'])
const REPO_PATH = /^\/hacimertgokhan\/server-monitor(\/|$)/
const OWNER_PATH = /^\/hacimertgokhan\/?$/
const CONTACT = 'mailto:hacimertgokhan@gmail.com'

export function isAllowedLink(raw: string): boolean {
  if (raw === CONTACT) return true
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  if (ALLOWED_HOSTS.has(u.hostname)) return true
  return u.hostname === 'github.com' && (REPO_PATH.test(u.pathname) || OWNER_PATH.test(u.pathname))
}

import type { Api } from '@shared/types'

export const AUTHOR = 'Hacı Mert Gökhan'
export const SITE_URL = 'https://hacimertgokhan.com'
export const SITE_LABEL = 'hacimertgokhan.com'
export const REPO_URL = 'https://github.com/hacimertgokhan/server-monitor'
export const CONTACT_URL = 'mailto:hacimertgokhan@gmail.com'
export const CONTACT_LABEL = 'hacimertgokhan@gmail.com'

/** Opens a link in the system browser. The main process re-checks it against an allow-list. */
export function openLink(api: Api | undefined, url: string): void {
  if (api) void api.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

/** Keyboard shortcut label for "bring the window back". */
export const restoreShortcut = (platform: string): string => (platform === 'darwin' ? '⌘⌥M' : 'Ctrl+Alt+M')

import type { ClipboardApi, SftpApi, TermApi } from '@shared/remote'
import type { Api } from '@shared/types'
import { demoRemote } from './demo-remote'

/** What Root mode talks to: the Electron backend for real servers, an in-memory fake for the demo servers. */
export interface Remote {
  term: TermApi
  sftp: SftpApi
  clipboard: ClipboardApi
  openWebLink(url: string): void
}

export function remoteFor(api: Api | undefined, demo: boolean): Remote {
  if (api && !demo) return { term: api.term, sftp: api.sftp, clipboard: api.clipboard, openWebLink: (u) => void api.openWebLink(u) }
  return { ...demoRemote, openWebLink: (u) => window.open(u, '_blank', 'noopener,noreferrer') }
}

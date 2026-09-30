import { describe, expect, it } from 'vitest'
import { isAllowedLink } from './links'

describe('isAllowedLink', () => {
  it('allows the author site, the repo and the contact address', () => {
    for (const u of [
      'https://hacimertgokhan.com',
      'https://hacimertgokhan.com/projects',
      'https://www.hacimertgokhan.com/',
      'https://github.com/hacimertgokhan/server-monitor',
      'https://github.com/hacimertgokhan/server-monitor/releases/tag/v0.4.0',
      'https://github.com/hacimertgokhan',
      'mailto:hacimertgokhan@gmail.com'
    ])
      expect(isAllowedLink(u), u).toBe(true)
  })

  it('refuses everything else', () => {
    for (const u of [
      'http://hacimertgokhan.com',
      'https://hacimertgokhan.com.evil.example',
      'https://evil.example/hacimertgokhan.com',
      'https://github.com/yaskagroup/crm.marcaspio',
      'https://github.com/hacimertgokhan/server-monitorx',
      'https://user:pw@hacimertgokhan.com',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'mailto:someone@else.example',
      'not a url',
      ''
    ])
      expect(isAllowedLink(u), u).toBe(false)
  })
})

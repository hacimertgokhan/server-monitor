import { describe, expect, it } from 'vitest'
import { shellQuote } from './shell'

const B = String.fromCharCode(92) // a single backslash, spelled out so no tool can mangle it

describe('shellQuote', () => {
  it('wraps plain text in single quotes', () => {
    expect(shellQuote('/var/www')).toBe("'/var/www'")
  })

  it('writes an embedded single quote as close-quote, backslash, quote, reopen-quote', () => {
    const quoted = shellQuote("it's here")
    expect(quoted).toBe("'it'" + B + "''s here'")
    expect(quoted.includes(B)).toBe(true)
    expect(quoted).toHaveLength("it's here".length + 2 + 3) // two outer quotes + three extra characters for the one inner quote
  })

  it('handles several quotes and a quote at either end', () => {
    expect(shellQuote("'")).toBe("''" + B + "'''")
    expect(shellQuote("a'b'c")).toBe("'a'" + B + "''b'" + B + "''c'")
  })

  it('neutralises shell metacharacters by keeping them inside single quotes', () => {
    expect(shellQuote('a b; rm -rf / $(x) `y`')).toBe("'a b; rm -rf / $(x) `y`'")
  })
})

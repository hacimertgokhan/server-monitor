const BACKSLASH = String.fromCharCode(92)

/** Quotes a string for a POSIX shell: wraps it in single quotes and writes every inner ' as '\'' (safe for any file name). */
export const shellQuote = (s: string): string => "'" + s.replace(/'/g, "'" + BACKSLASH + "''") + "'"

import { DEFAULT_TERMINAL } from '@shared/remote'

/** The colour fields xterm.js understands (a subset of its `ITheme`). */
export interface TermColors {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface TermTheme {
  id: string
  name: string
  dark: boolean
  colors: TermColors
}

type Ansi = [
  black: string,
  red: string,
  green: string,
  yellow: string,
  blue: string,
  magenta: string,
  cyan: string,
  white: string,
  brightBlack: string,
  brightRed: string,
  brightGreen: string,
  brightYellow: string,
  brightBlue: string,
  brightMagenta: string,
  brightCyan: string,
  brightWhite: string
]

function make(id: string, name: string, dark: boolean, base: { bg: string; fg: string; cursor?: string; sel: string }, a: Ansi): TermTheme {
  return {
    id,
    name,
    dark,
    colors: {
      background: base.bg,
      foreground: base.fg,
      cursor: base.cursor ?? base.fg,
      cursorAccent: base.bg,
      selectionBackground: base.sel,
      black: a[0],
      red: a[1],
      green: a[2],
      yellow: a[3],
      blue: a[4],
      magenta: a[5],
      cyan: a[6],
      white: a[7],
      brightBlack: a[8],
      brightRed: a[9],
      brightGreen: a[10],
      brightYellow: a[11],
      brightBlue: a[12],
      brightMagenta: a[13],
      brightCyan: a[14],
      brightWhite: a[15]
    }
  }
}

const SOLARIZED: Ansi = [
  '#073642',
  '#dc322f',
  '#859900',
  '#b58900',
  '#268bd2',
  '#d33682',
  '#2aa198',
  '#eee8d5',
  '#002b36',
  '#cb4b16',
  '#586e75',
  '#657b83',
  '#839496',
  '#6c71c4',
  '#93a1a1',
  '#fdf6e3'
]

export const TERMINAL_THEMES: TermTheme[] = [
  make('ash', 'Monochrome Ash', true, { bg: '#000000', fg: '#c9c7c7', sel: '#3a3838' }, [
    '#272727',
    '#d98282',
    '#8fbf9f',
    '#d9c47a',
    '#7fa8d1',
    '#b394c9',
    '#7fbfbf',
    '#c9c7c7',
    '#5c5959',
    '#e49a9a',
    '#a5d1b3',
    '#e8d592',
    '#99bde0',
    '#c6aedb',
    '#98d1d1',
    '#ffffff'
  ]),
  make('dracula', 'Dracula', true, { bg: '#282a36', fg: '#f8f8f2', sel: '#44475a' }, [
    '#21222c',
    '#ff5555',
    '#50fa7b',
    '#f1fa8c',
    '#bd93f9',
    '#ff79c6',
    '#8be9fd',
    '#f8f8f2',
    '#6272a4',
    '#ff6e6e',
    '#69ff94',
    '#ffffa5',
    '#d6acff',
    '#ff92df',
    '#a4ffff',
    '#ffffff'
  ]),
  make('nord', 'Nord', true, { bg: '#2e3440', fg: '#d8dee9', sel: '#434c5e' }, [
    '#3b4252',
    '#bf616a',
    '#a3be8c',
    '#ebcb8b',
    '#81a1c1',
    '#b48ead',
    '#88c0d0',
    '#e5e9f0',
    '#4c566a',
    '#bf616a',
    '#a3be8c',
    '#ebcb8b',
    '#81a1c1',
    '#b48ead',
    '#8fbcbb',
    '#eceff4'
  ]),
  make('tokyo-night', 'Tokyo Night', true, { bg: '#1a1b26', fg: '#c0caf5', sel: '#33467c' }, [
    '#15161e',
    '#f7768e',
    '#9ece6a',
    '#e0af68',
    '#7aa2f7',
    '#bb9af7',
    '#7dcfff',
    '#a9b1d6',
    '#414868',
    '#f7768e',
    '#9ece6a',
    '#e0af68',
    '#7aa2f7',
    '#bb9af7',
    '#7dcfff',
    '#c0caf5'
  ]),
  make('one-dark', 'One Dark', true, { bg: '#282c34', fg: '#abb2bf', cursor: '#528bff', sel: '#3e4451' }, [
    '#282c34',
    '#e06c75',
    '#98c379',
    '#e5c07b',
    '#61afef',
    '#c678dd',
    '#56b6c2',
    '#abb2bf',
    '#5c6370',
    '#e06c75',
    '#98c379',
    '#e5c07b',
    '#61afef',
    '#c678dd',
    '#56b6c2',
    '#ffffff'
  ]),
  make('catppuccin', 'Catppuccin Mocha', true, { bg: '#1e1e2e', fg: '#cdd6f4', cursor: '#f5e0dc', sel: '#45475a' }, [
    '#45475a',
    '#f38ba8',
    '#a6e3a1',
    '#f9e2af',
    '#89b4fa',
    '#f5c2e7',
    '#94e2d5',
    '#bac2de',
    '#585b70',
    '#f38ba8',
    '#a6e3a1',
    '#f9e2af',
    '#89b4fa',
    '#f5c2e7',
    '#94e2d5',
    '#a6adc8'
  ]),
  make('gruvbox', 'Gruvbox Dark', true, { bg: '#282828', fg: '#ebdbb2', sel: '#504945' }, [
    '#282828',
    '#cc241d',
    '#98971a',
    '#d79921',
    '#458588',
    '#b16286',
    '#689d6a',
    '#a89984',
    '#928374',
    '#fb4934',
    '#b8bb26',
    '#fabd2f',
    '#83a598',
    '#d3869b',
    '#8ec07c',
    '#ebdbb2'
  ]),
  make('monokai', 'Monokai', true, { bg: '#272822', fg: '#f8f8f2', sel: '#49483e' }, [
    '#272822',
    '#f92672',
    '#a6e22e',
    '#f4bf75',
    '#66d9ef',
    '#ae81ff',
    '#a1efe4',
    '#f8f8f2',
    '#75715e',
    '#f92672',
    '#a6e22e',
    '#f4bf75',
    '#66d9ef',
    '#ae81ff',
    '#a1efe4',
    '#f9f8f5'
  ]),
  make('solarized-dark', 'Solarized Dark', true, { bg: '#002b36', fg: '#839496', cursor: '#93a1a1', sel: '#073642' }, SOLARIZED),
  make('matrix', 'Matrix', true, { bg: '#000000', fg: '#33ff66', sel: '#0b3d1a' }, [
    '#001a08',
    '#ff4d4d',
    '#33ff66',
    '#d6ff4d',
    '#4dc3ff',
    '#d84dff',
    '#4dffd2',
    '#b8ffcc',
    '#1f7a3a',
    '#ff8080',
    '#80ff9f',
    '#e8ff80',
    '#80d4ff',
    '#e680ff',
    '#80ffe0',
    '#ffffff'
  ]),
  make('solarized-light', 'Solarized Light', false, { bg: '#fdf6e3', fg: '#657b83', cursor: '#586e75', sel: '#eee8d5' }, SOLARIZED),
  make('github-light', 'GitHub Light', false, { bg: '#ffffff', fg: '#24292f', sel: '#b6d6fd' }, [
    '#24292f',
    '#cf222e',
    '#116329',
    '#4d2d00',
    '#0969da',
    '#8250df',
    '#1b7c83',
    '#6e7781',
    '#57606a',
    '#a40e26',
    '#1a7f37',
    '#633c01',
    '#218bff',
    '#a475f9',
    '#3192aa',
    '#8c959f'
  ])
]

export function getTerminalTheme(id: string): TermTheme {
  return TERMINAL_THEMES.find((t) => t.id === id) ?? TERMINAL_THEMES.find((t) => t.id === DEFAULT_TERMINAL.theme) ?? TERMINAL_THEMES[0]
}

export const FONT_STACKS = {
  jetbrains: '"JetBrains Mono", "Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace',
  system: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace'
} as const

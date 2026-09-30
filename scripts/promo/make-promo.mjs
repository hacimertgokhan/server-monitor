// Generates docs/media: a ~20 s narrated promo video (mp4 + gif) and README screenshots.
//
// Fully headless — nothing appears on screen and the real mouse/keyboard are never touched:
//   * UI:      Vite dev server + headless Google Chrome driven by Playwright (virtual pointer, demo data)
//   * Voice:   Windows SAPI (System.Speech) writes WAV files directly; nothing is played through the speakers
//   * Muxing:  ffmpeg
//
// Requirements: Windows, Google Chrome, ffmpeg on PATH.   Usage: npm run promo
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'docs', 'media')
const W = 1920
const H = 1080
const PORT = 5199
const REPO_TEXT = 'github.com/hacimertgokhan/server-monitor'

// One entry per scene: what is said, and the minimum time the scene stays on screen.
const SCENES = [
  { say: 'Your servers, live on your desktop.', caption: 'Your servers, live on your desktop', min: 3.4 },
  {
    say: 'CPU, memory, disk, uptime, Docker, PM2, services and ports.',
    caption: 'CPU · RAM · Disk · Uptime · Docker · PM2 · Services · Ports',
    min: 6.0
  },
  { say: 'Auto, grid or free layout. Resize any card.', caption: 'Auto, grid or free layout. Resizable cards', min: 5.0 },
  { say: 'Window, mini, or live wallpaper.', caption: 'Window · Mini · Live wallpaper', min: 3.6 }
]
const TAIL = 1.2

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${r.stderr || r.stdout}`)
  return r.stdout
}

// ---------------------------------------------------------------- narration (SAPI -> WAV)
function synthesize(tmp) {
  const script = join(tmp, 'tts.ps1')
  writeFileSync(
    script,
    `param([string]$Text, [string]$Out)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$en = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1
if ($en) { $s.SelectVoice($en.VoiceInfo.Name) }
$s.Rate = 2
$s.SetOutputToWaveFile($Out)
$s.Speak($Text)
$s.Dispose()
`
  )
  return SCENES.map((sc, i) => {
    const wav = join(tmp, `say${i}.wav`)
    run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Text', sc.say, '-Out', wav])
    const dur = parseFloat(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]))
    return { wav, dur }
  })
}

// ---------------------------------------------------------------- page helpers
const OVERLAY = `(() => {
  if (window.__ov) return
  window.__ov = true
  const css = document.createElement('style')
  css.textContent = \`
    #ov-cap{position:fixed;left:50%;bottom:64px;transform:translateX(-50%) translateY(8px);max-width:1500px;padding:16px 34px;border-radius:16px;
      background:rgba(8,8,8,.82);border:1px solid #272727;color:#c9c7c7;font:500 34px/1.3 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;
      text-align:center;opacity:0;transition:opacity .4s,transform .4s;z-index:99998;pointer-events:none;white-space:nowrap}
    #ov-cap.on{opacity:1;transform:translateX(-50%) translateY(0)}
    #ov-cur{position:fixed;left:0;top:0;z-index:100000;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.7))}
    #ov-ring{position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid #c9c7c7;opacity:0;z-index:99999;pointer-events:none}
    #ov-ring.go{animation:ov-click .45s ease-out}
    @keyframes ov-click{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.4)}}
    #ov-title{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;z-index:99997;pointer-events:none;
      background:radial-gradient(ellipse at center,rgba(0,0,0,.55),rgba(0,0,0,.05) 70%);opacity:0;transition:opacity .8s;font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif}
    #ov-title.on{opacity:1}
    #ov-title h1{margin:0;font-weight:200;font-size:112px;letter-spacing:.02em;color:#c9c7c7}
    #ov-title p{margin:0;font-size:32px;letter-spacing:.28em;text-transform:uppercase;color:#969393}
  \`
  document.head.appendChild(css)
  const mk = (tag, id, html) => { const e = document.createElement(tag); e.id = id; if (html) e.innerHTML = html; document.body.appendChild(e); return e }
  mk('div', 'ov-cap')
  mk('div', 'ov-ring')
  mk('div', 'ov-title', '<h1></h1><p></p>')
  mk('div', 'ov-cur', '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2 4 19 8.5 14.8 11.6 21.5 14.2 20.3 11.2 13.7 17.5 13.5Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>')
  const cur = document.getElementById('ov-cur'), ring = document.getElementById('ov-ring')
  addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)' }, true)
  addEventListener('mousedown', (e) => { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go') }, true)
  window.__caption = (t) => { const c = document.getElementById('ov-cap'); if (!t) return c.classList.remove('on'); c.textContent = t; c.classList.add('on') }
  window.__title = (h, p) => { const t = document.getElementById('ov-title'); if (!h) return t.classList.remove('on'); t.querySelector('h1').textContent = h; t.querySelector('p').textContent = p || ''; t.classList.add('on') }
})()`

async function glide(page, x, y, ms = 700) {
  const from = (await page.evaluate(() => window.__pos)) ?? { x: W / 2, y: H / 2 }
  const start = Date.now()
  // Time-based (not step-based): every mouse.move call has round-trip latency, so fixed sleeps would run ~2x too long.
  for (;;) {
    const t = Math.min(1, (Date.now() - start) / ms)
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 // ease in-out
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
    if (t >= 1) break
  }
  await page.evaluate(([px, py]) => (window.__pos = { x: px, y: py }), [x, y])
}

const center = async (loc) => {
  const b = await loc.boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }
}

async function click(page, loc, ms = 650) {
  const { x, y } = await center(loc)
  await glide(page, x, y, ms)
  await sleep(120)
  await page.mouse.down()
  await sleep(70)
  await page.mouse.up()
}

async function drag(page, from, to, ms = 900) {
  await glide(page, from.x, from.y, 350)
  await page.mouse.down()
  await sleep(60)
  await glide(page, to.x, to.y, ms)
  await page.mouse.up()
}

// ---------------------------------------------------------------- main
async function main() {
  mkdirSync(OUT, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'sm-promo-'))
  const stillsOnly = process.argv.includes('--stills')
  console.log(stillsOnly ? '• stills only' : '• synthesising narration')
  const say = stillsOnly ? SCENES.map(() => ({ wav: '', dur: 1 })) : synthesize(tmp)
  const lens = SCENES.map((s, i) => Math.max(s.min, say[i].dur + 0.6))
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0))
  const total = lens.reduce((a, b) => a + b, 0) + TAIL
  console.log(`  scene lengths: ${lens.map((l) => l.toFixed(1)).join(' + ')} + ${TAIL} tail = ${total.toFixed(1)} s`)

  console.log('• starting UI (Vite) and headless Chrome')
  const server = await createServer({
    configFile: join(ROOT, 'vite.web.config.ts'),
    server: { port: PORT, strictPort: true },
    logLevel: 'error'
  })
  await server.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })

  // ---- README stills (separate context, no recording)
  const still = await browser.newContext({ viewport: { width: W, height: H }, locale: 'en-US' })
  const sp = await still.newPage()
  await sp.goto(`http://localhost:${PORT}/?mode=wallpaper`)
  await sp.waitForTimeout(4500)
  await sp.screenshot({ path: join(OUT, 'wallpaper.png') })
  await sp.evaluate(() => document.querySelector('button.absolute')?.click())
  await sp.waitForTimeout(1500)
  await sp.getByRole('button', { name: 'Grid' }).click()
  await sp.waitForTimeout(2500)
  await sp.screenshot({ path: join(OUT, 'window-grid.png') })
  await sp.getByRole('button', { name: 'Auto (radial)' }).click()
  await sp.waitForTimeout(2500)
  await sp.screenshot({ path: join(OUT, 'window-radial.png') })
  await sp.getByText('api-eu').first().click({ force: true })
  await sp.getByRole('tab', { name: /Docker/ }).click()
  await sp.waitForTimeout(800)
  await sp.screenshot({ path: join(OUT, 'detail-docker.png') })
  await sp.keyboard.press('Escape')
  // expandable sub-trees: open Docker / PM2 / Services / Ports under one server
  await sp.getByRole('button', { name: 'Grid' }).click()
  const web = sp.locator('[data-id=demo-web] button')
  for (const label of [/^8\/8$/, /^PM2 4\/4$/, /^11$/, /^5$/]) await web.filter({ hasText: label }).first().click()
  await sp.waitForTimeout(600)
  await sp.getByRole('button', { name: 'Fit to screen' }).click()
  await sp.waitForTimeout(2200)
  await sp.screenshot({ path: join(OUT, 'subtree.png') })
  await still.close()
  if (process.argv.includes('--stills')) {
    await browser.close()
    await server.close()
    rmSync(tmp, { recursive: true, force: true })
    console.log('✔ stills only → ' + OUT)
    return
  }

  // ---- the recorded run
  console.log('• recording')
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    locale: 'en-US',
    recordVideo: { dir: tmp, size: { width: W, height: H } }
  })
  const page = await ctx.newPage()
  const created = Date.now()
  await page.goto(`http://localhost:${PORT}/?mode=wallpaper`)
  await page.addStyleTag({ content: '*{cursor:none!important}' })
  await page.evaluate(OVERLAY)
  await page.mouse.move(W * 0.72, H * 0.6)
  await page.evaluate(([x, y]) => (window.__pos = { x, y }), [W * 0.72, H * 0.6])
  await page.waitForTimeout(2500) // let cards settle + fit animation finish before the timeline starts
  const t0 = Date.now()
  const offset = (t0 - created) / 1000
  const untilScene = async (i, end = false) => {
    const target = t0 + (end ? starts[i] + lens[i] : starts[i]) * 1000
    await sleep(Math.max(0, target - Date.now()))
  }

  // Scene 1 — wallpaper view + title
  await page.evaluate(
    ([c]) => {
      window.__title('Server Monitor', 'live on your desktop')
      window.__caption(c)
    },
    [SCENES[0].caption]
  )
  await sleep(2300)
  await page.evaluate(() => window.__title(null))
  await untilScene(0, true)

  // Scene 2 — window mode, open a server, browse tabs
  await untilScene(1)
  await page.evaluate(([c]) => window.__caption(c), [SCENES[1].caption])
  await click(page, page.getByRole('button', { name: 'Exit' }), 500)
  await sleep(900)
  await click(page, page.getByText('api-eu').first(), 600)
  await page.waitForSelector('[role=dialog]')
  await sleep(900)
  await click(page, page.getByRole('tab', { name: /Docker/ }), 450)
  await sleep(700)
  await click(page, page.getByRole('tab', { name: /Ports/ }), 400)
  await sleep(600)
  await page.keyboard.press('Escape')
  await untilScene(1, true)

  // Scene 3 — layouts and resizing
  await untilScene(2)
  await page.evaluate(([c]) => window.__caption(c), [SCENES[2].caption])
  await click(page, page.getByRole('button', { name: 'Grid' }), 500)
  await sleep(800)
  // enlarge all cards with the size slider
  const slider = await center(page.locator('input[type=range]'))
  await drag(page, { x: slider.b.x + slider.b.width * 0.42, y: slider.y }, { x: slider.b.x + slider.b.width * 0.8, y: slider.y }, 500)
  await sleep(300)
  await click(page, page.getByRole('button', { name: 'Fit to screen' }), 400)
  await sleep(500)
  // free placement: move one card
  await click(page, page.getByRole('button', { name: 'Free placement' }), 400)
  const db = await center(page.locator('[data-id=demo-db]'))
  // drop it in the free space to the right of the bottom row (never on top of another card)
  const nas = await center(page.locator('[data-id=demo-nas]'))
  const tx = Math.min(nas.b.x + nas.b.width + 40 + db.b.width / 2, W - db.b.width / 2 - 30)
  await drag(page, { x: db.x, y: db.b.y + 30 }, { x: tx, y: nas.y + (db.b.y + 30 - db.y) }, 700)
  await untilScene(2, true)

  // Scene 4 — modes + outro
  await untilScene(3)
  await page.evaluate(([c]) => window.__caption(c), [SCENES[3].caption])
  await click(page, page.getByRole('button', { name: 'Mini' }), 500)
  await sleep(800)
  const wall = page.getByRole('button', { name: 'Wallpaper mode' })
  await click(page, wall, 500)
  await sleep(400)
  await page.evaluate(
    ([t]) => {
      window.__caption(null)
      window.__title('Server Monitor', t)
    },
    [REPO_TEXT]
  )
  await sleep(Math.max(0, t0 + total * 1000 - Date.now()))

  const videoPath = await page.video().path()
  await ctx.close()
  await browser.close()
  await server.close()

  // ---- mux video + narration + soft pad
  console.log('• encoding')
  const mp4 = join(OUT, 'promo.mp4')
  const inputs = []
  say.forEach((s) => inputs.push('-i', s.wav))
  const n = say.length
  const delays = say.map(
    (_, i) => `[${i + 1}:a]adelay=${Math.round(starts[i] * 1000 + 250)}|${Math.round(starts[i] * 1000 + 250)},volume=1.5[v${i}]`
  )
  const chord = [196, 294, 392].map((f) => ['-f', 'lavfi', '-t', String(total), '-i', `sine=frequency=${f}:sample_rate=44100`]).flat()
  const mIdx = n + 1
  const filter = [
    ...delays,
    `${say.map((_, i) => `[v${i}]`).join('')}amix=inputs=${n}:normalize=0[narr]`,
    `[${mIdx}:a][${mIdx + 1}:a][${mIdx + 2}:a]amix=inputs=3:normalize=0,lowpass=f=900,tremolo=f=0.35:d=0.45,volume=0.16,afade=t=in:d=1.5,afade=t=out:st=${(total - 2).toFixed(2)}:d=2[pad]`,
    `[narr][pad]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95[aout]`
  ].join(';')
  run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    offset.toFixed(2),
    '-i',
    videoPath,
    ...inputs,
    ...chord,
    '-filter_complex',
    filter,
    '-map',
    '0:v',
    '-map',
    '[aout]',
    '-t',
    total.toFixed(2),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-vf',
    'fade=t=in:st=0:d=0.5',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    mp4
  ])
  const gif = join(OUT, 'promo.gif')
  run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    mp4,
    '-vf',
    'fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop',
    '0',
    gif
  ])
  run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '9', '-i', mp4, '-frames:v', '1', join(OUT, 'promo-poster.png')])

  rmSync(tmp, { recursive: true, force: true })
  console.log(`✔ done → ${OUT} (video ${total.toFixed(1)} s)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

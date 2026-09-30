import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Language } from '@shared/types'

export type Lang = 'en' | 'tr'
type Vars = Record<string, string | number>

/** English source strings are the keys; only non-English catalogues are listed. */
const tr: Record<string, string> = {
  // top bar
  online: 'çevrimiçi',
  offline: 'çevrimdışı',
  'Avg CPU': 'Ort. CPU',
  Window: 'Pencere',
  Mini: 'Mini',
  Wallpaper: 'Duvar kağıdı',
  'Auto (radial)': 'Otomatik (dairesel)',
  Grid: 'Izgara',
  'Free placement': 'Serbest yerleşim',
  'Card size': 'Kart boyutu',
  'Fit to screen': 'Ekrana sığdır',
  'Expand all': 'Tümünü aç (alt ağaçlar)',
  'Collapse all': 'Tümünü kapat (alt ağaçlar)',
  'Hide from flowchart': 'Şemadan gizle',
  '+{n} more': '+{n} tane daha',
  'Show fewer': 'Daha az göster',
  'Reset layout': 'Yerleşimi sıfırla',
  Settings: 'Ayarlar',
  'Add server': 'Sunucu ekle',
  // hub
  Me: 'Ben',
  'No servers': 'Sunucu yok',
  '{online}/{total} online': '{online}/{total} çevrimiçi',
  // server node
  '{n} cores': '{n} çekirdek',
  Offline: 'Çevrimdışı',
  'dropped {t} ago': '{t} önce koptu',
  'Load average (1 min)': 'Yük ortalaması (1 dk)',
  'Server uptime': 'Sunucu uptime',
  'Docker containers (running/total)': 'Docker konteynerleri (çalışan/toplam)',
  'PM2 processes (online/total)': 'PM2 süreçleri (online/toplam)',
  'systemd services': 'systemd servisleri',
  'Listening ports': 'Dinleyen portlar',
  '{n} failed': '{n} hatalı',
  'Drag to resize': 'Boyutlandırmak için sürükle',
  Disk: 'Disk',
  // empty state
  'No servers yet': 'Henüz sunucu yok',
  'Add your SSH details and CPU, RAM, disk, Docker, PM2, services and ports show up live.':
    'SSH bilgilerini ekleyin; CPU, RAM, disk, Docker, PM2, servisler ve portlar canlı görünsün.',
  'Preview with demo': 'Demo ile önizle',
  Exit: 'Çık',
  // mini
  'No servers. Add one from window mode.': 'Sunucu yok. Pencere modundan ekleyin.',
  'Wallpaper mode': 'Duvar kağıdı modu',
  'Window mode': 'Pencere modu',
  // detail
  Edit: 'Düzenle',
  Delete: 'Sil',
  'Offline — {reason}': 'Çevrimdışı — {reason}',
  'no connection': 'bağlantı yok',
  'Connecting…': 'Bağlanıyor…',
  Overview: 'Genel',
  Services: 'Servisler',
  Ports: 'Portlar',
  Disks: 'Diskler',
  cores: 'çekirdek',
  none: 'yok',
  'CPU (recent)': 'CPU (son dakikalar)',
  'RAM (recent)': 'RAM (son dakikalar)',
  Uptime: 'Sunucu uptime',
  'Load (1/5/15)': 'Yük (1/5/15)',
  Network: 'Ağ',
  Latency: 'Gecikme',
  'Availability 24h': 'Erişilebilirlik 24s',
  '7 days': '7 gün',
  '30 days': '30 gün',
  'Outages (24h)': 'Kesinti (24s)',
  'Availability is only measured while this app is running (since {date}).':
    'Erişilebilirlik yalnızca bu uygulama çalışırken ölçülür ({date} tarihinden beri).',
  Container: 'Konteyner',
  Image: 'İmaj',
  Status: 'Durum',
  'Docker not found, or this user cannot access it (docker group / root may be required).':
    'Docker bulunamadı veya bu kullanıcı erişemiyor (docker grubu / root gerekebilir).',
  'PM2 not found.': 'PM2 bulunamadı.',
  'PM2 is installed but its daemon is not running for this user.': 'PM2 kurulu ama bu kullanıcı için daemon çalışmıyor.',
  Name: 'Ad',
  Memory: 'Bellek',
  Restarts: 'Restart',
  Age: 'Süre',
  'systemd not found.': 'systemd bulunamadı.',
  'Failed:': 'Hatalı:',
  'No listening ports found (ss/netstat may be missing).': 'Dinleyen port bulunamadı (ss/netstat yok olabilir).',
  Port: 'Port',
  Proto: 'Proto',
  Exposure: 'Erişim',
  Process: 'Süreç',
  public: 'dışa açık',
  local: 'yerel',
  'Remove "{name}" from monitoring?': '"{name}" izlemeden kaldırılsın mı?',
  // server dialog
  'Edit server': 'Sunucuyu düzenle',
  'Details are stored on this computer, encrypted with Windows credential protection (DPAPI). Only read-only commands run on the remote host.':
    'Bilgiler Windows kimlik şifrelemesiyle (DPAPI) bu bilgisayarda saklanır. Uzak sunucuda yalnızca okuma komutları çalıştırılır.',
  'Browser preview: use the desktop app to save servers.':
    'Tarayıcı önizlemesindesiniz: sunucu kaydetmek için masaüstü uygulamasını kullanın.',
  'Display name': 'Görünen ad',
  'Host / IP': 'Host / IP',
  User: 'Kullanıcı',
  Password: 'Şifre',
  'SSH key': 'SSH anahtarı',
  '(leave empty to keep the stored password)': '(boş bırakırsanız mevcut şifre korunur)',
  'Private key file': 'Özel anahtar dosyası',
  'Key passphrase (if any)': 'Anahtar parolası (varsa)',
  'Test connection': 'Bağlantıyı test et',
  Save: 'Kaydet',
  'Connected · {ms} ms': 'Bağlantı başarılı · {ms} ms',
  // settings
  'Refresh interval': 'Yenileme aralığı',
  'How often servers are polled': 'Sunucular bu sıklıkla sorgulanır',
  '{n} s': '{n} sn',
  'Minimize to tray on close': 'Kapatınca tepsiye küçült',
  'The app keeps monitoring in the background (needed for uptime history)':
    'Uygulama arka planda izlemeye devam eder (uptime kaydı için önemli)',
  'Only works in the installed (packaged) app': 'Yalnızca kurulu (paketlenmiş) uygulamada çalışır',
  'Mini mode always on top': 'Mini mod her zaman üstte',
  'Demo data': 'Demo verisi',
  'Shows fake servers for previewing when none are configured': 'Sunucu eklenmemişken önizleme için sahte sunucular gösterir',
  Language: 'Dil',
  Auto: 'Otomatik',
  'Wallpaper mode is not clickable. Press {key} or use the tray icon to return to the window.':
    'Duvar kağıdı modundayken tıklanamaz. Pencereye dönmek için {key} veya tepsi simgesi.',
  'No problems right now': 'Şu an sorun yok',
  'No servers match your search': 'Aramanızla eşleşen sunucu yok',
  'Search servers…  ( / )': 'Sunucu ara…  ( / )',
  'Search servers': 'Sunucu ara',
  Clear: 'Temizle',
  'Show only servers with problems': 'Yalnızca sorunlu sunucuları göster',
  'Problems only': 'Yalnızca sorunlular',
  Problems: 'Sorunlar',
  '{n} open': '{n} açık sorun',
  'Nothing needs attention right now.': 'Şu an ilgilenmeniz gereken bir şey yok.',
  'All systems healthy': 'Tüm sistemler sağlıklı',
  Open: 'Aç',
  Logs: 'Loglar',
  'Container logs': 'Konteyner logları',
  'PM2 logs': 'PM2 logları',
  'Service logs (journal)': 'Servis logları (journal)',
  'Search in logs…': 'Loglarda ara…',
  'Show only matching lines': 'Yalnızca eşleşen satırları göster',
  'Only matches': 'Yalnızca eşleşenler',
  Errors: 'Hatalar',
  Warnings: 'Uyarılar',
  Lines: 'Satır',
  '{n} lines': '{n} satır',
  Live: 'Canlı',
  'Wrap long lines': 'Uzun satırları kaydır',
  'Follow newest line': 'En yeni satırı takip et',
  Refresh: 'Yenile',
  Copy: 'Kopyala',
  'Save as file': 'Dosyaya kaydet',
  'Loading…': 'Yükleniyor…',
  'Could not read the logs': 'Loglar okunamadı',
  'No lines match the filter': 'Filtreyle eşleşen satır yok',
  'No log output.': 'Log çıktısı yok.',
  'updated {t}': 'güncellendi {t}',
  'Open logs': 'Logları aç',
  'Check for updates': 'Güncellemeleri denetle',
  'Could not check for updates': 'Güncellemeler denetlenemedi',
  'Version {v} is available.': '{v} sürümü yayında.',
  Download: 'İndir',
  'You are up to date.': 'Güncelsiniz.',
  'Made by {name}.': 'Yapımcı: {name}.',
  'Updates are only checked when you press the button; nothing else leaves your computer except your SSH connections.':
    'Güncellemeler yalnızca düğmeye bastığınızda denetlenir; SSH bağlantılarınız dışında bilgisayarınızdan hiçbir şey çıkmaz.',
  'Desktop notifications': 'Masaüstü bildirimleri',
  'Tells you when a server goes offline, load stays high, or a container, PM2 process or service fails':
    'Bir sunucu çevrimdışı olduğunda, yük yüksek kaldığında veya bir konteyner, PM2 süreci ya da servis hata verdiğinde haber verir',
  'CPU alert above': 'CPU uyarı eşiği',
  'Memory alert above': 'Bellek uyarı eşiği',
  'Disk alert above': 'Disk uyarı eşiği',
  'Start at login': 'Oturum açılınca başlat',
  'Server is offline': 'Sunucu çevrimdışı',
  'Unknown item': 'Bilinmeyen öğe',
  'Unsafe name': 'Güvenli olmayan ad',
  'Secure credential storage is not available on this system. On Linux install a keyring (GNOME Keyring or KWallet), or use an SSH key without a passphrase.':
    "Bu sistemde güvenli kimlik bilgisi depolama yok. Linux'ta bir anahtar zinciri (GNOME Keyring veya KWallet) kurun ya da parolasız bir SSH anahtarı kullanın.",
  'Every call an agent makes, including refused ones. Stored only on this computer.':
    'Ajanların yaptığı her çağrı, reddedilenler dahil. Yalnızca bu bilgisayarda saklanır.',
  'Clear the whole activity log?': 'Tüm etkinlik kaydı silinsin mi?',
  'No activity yet': 'Henüz etkinlik yok',
  Time: 'Zaman',
  Agent: 'Ajan',
  Tool: 'Araç',
  Server: 'Sunucu',
  'Command / target': 'Komut / hedef',
  Result: 'Sonuç',
  'Edit agent': 'Ajanı düzenle',
  'New agent': 'Yeni ajan',
  'Each agent gets its own token and its own permissions.': 'Her ajanın kendi anahtarı (token) ve kendi yetkileri vardır.',
  Permissions: 'Yetkiler',
  'List servers, live status, problems': 'Sunucuları, canlı durumu ve sorunları görme',
  'Docker, PM2 and journal logs': 'Docker, PM2 ve journal logları',
  'Shell commands over SSH, limited by your policy': 'SSH üzerinden komut çalıştırma, politikanızla sınırlı',
  'Read status': 'Durumu okuma',
  'Read logs': 'Logları okuma',
  'Run commands': 'Komut çalıştırma',
  Servers: 'Sunucular',
  'All servers': 'Tüm sunucular',
  'Selected servers': 'Seçili sunucular',
  Cancel: 'Vazgeç',
  'Create agent': 'Ajan oluştur',
  'Token for {name}': '{name} için token',
  'Copy it now. For your safety only a fingerprint is stored, so it cannot be shown again (you can generate a new one).':
    'Şimdi kopyalayın. Güvenliğiniz için yalnızca parmak izi saklanır, bu yüzden tekrar gösterilemez (yenisini üretebilirsiniz).',
  'I have copied it': 'Kopyaladım',
  'Agents that may connect. Disable or delete one to cut it off immediately.':
    'Bağlanabilen ajanlar. Birini devre dışı bırakmak veya silmek erişimi anında keser.',
  'Add agent': 'Ajan ekle',
  'No agents yet': 'Henüz ajan yok',
  'Create an agent to get a token you can give to Claude Code, Cursor or any MCP client.':
    'Claude Code, Cursor veya herhangi bir MCP istemcisine verebileceğiniz bir token almak için ajan oluşturun.',
  Connected: 'Bağlı',
  'Not connected': 'Bağlı değil',
  '{n} calls': '{n} çağrı',
  'last seen {t}': 'son görülme {t}',
  Enabled: 'Etkin',
  'Generate a new token': 'Yeni token üret',
  'Generate a new token for "{name}"? The old one stops working immediately.':
    '"{name}" için yeni token üretilsin mi? Eskisi anında çalışmaz olur.',
  'Delete agent "{name}"?': '"{name}" ajanı silinsin mi?',
  'Agents (MCP)': 'Ajanlar (MCP)',
  'Let AI agents look at your servers and, if you allow it, run commands, under rules you control.':
    'Yapay zekâ ajanları sunucularınıza baksın ve izin verirseniz sizin belirlediğiniz kurallarla komut çalıştırsın.',
  Agents: 'Ajanlar',
  Policy: 'Politika',
  Activity: 'Etkinlik',
  'Claude Code': 'Claude Code',
  'JSON config (Cursor, Windsurf, others)': 'JSON yapılandırma (Cursor, Windsurf, diğerleri)',
  'MCP server is running': 'MCP sunucusu çalışıyor',
  'MCP server could not start': 'MCP sunucusu başlatılamadı',
  'MCP server is off': 'MCP sunucusu kapalı',
  'Listening on {url}. {n} agent(s) configured.': '{url} adresinde dinliyor. {n} ajan tanımlı.',
  'Agents such as Claude Code or Cursor can connect to your servers through this app.':
    'Claude Code veya Cursor gibi ajanlar bu uygulama üzerinden sunucularınıza bağlanabilir.',
  Enable: 'Etkinleştir',
  'Give agents only the access they need': 'Ajanlara yalnızca ihtiyaç duydukları erişimi verin',
  'An agent can read your servers, and — if you allow it — run commands over your SSH connections. Commands are checked against your policy, can require your approval in a native dialog, and every call is logged. The endpoint is only reachable from this computer.':
    'Bir ajan sunucularınızı okuyabilir ve izin verirseniz SSH bağlantılarınız üzerinden komut çalıştırabilir. Komutlar politikanıza göre denetlenir, yerel bir pencerede onayınızı isteyebilir ve her çağrı kaydedilir. Uç nokta yalnızca bu bilgisayardan erişilebilir.',
  Endpoint: 'Uç nokta',
  Apply: 'Uygula',
  'Transport: Streamable HTTP · authentication: one bearer token per agent (create agents in the Agents tab).':
    'Aktarım: Streamable HTTP · kimlik doğrulama: ajan başına bir bearer token (ajanları Ajanlar sekmesinde oluşturun).',
  'Connect an agent': 'Bir ajan bağlayın',
  'Create an agent to get its token, then use one of these. Replace <AGENT_TOKEN> with that token.':
    'Önce bir ajan oluşturup tokenını alın, sonra bunlardan birini kullanın. <AGENT_TOKEN> yerine o tokenı yazın.',
  'Restore defaults': 'Varsayılanları geri yükle',
  'Ignored (invalid): {rules}': 'Yok sayıldı (geçersiz): {rules}',
  'A deny list can be bypassed (encoded commands, scripts, aliases). For real safety use "Ask me" or "Allow list only".':
    'Kara liste atlatılabilir (kodlanmış komutlar, betikler, takma adlar). Gerçek güvenlik için "Bana sor" veya "Yalnızca izin listesi"ni kullanın.',
  'Run allow-listed commands without asking': 'İzin listesindeki komutları sormadan çalıştır',
  'In "Ask me" mode: safe diagnostics run immediately, everything else asks.':
    '"Bana sor" modunda: güvenli tanılama komutları hemen çalışır, gerisi sorar.',
  'Allow pipes and command chaining': 'Boru (pipe) ve komut zincirlemeye izin ver',
  'a | b, a && b, a ; b are allowed when every part is allowed.': 'a | b, a && b, a ; b, her parça izinliyse çalışır.',
  'Timeout (seconds)': 'Zaman aşımı (saniye)',
  'Max output (KB)': 'En fazla çıktı (KB)',
  'Deny list': 'Kara liste',
  'One rule per line. Plain text matches anywhere in the command; * is a wildcard; /regex/ is a regular expression.':
    'Satır başına bir kural. Düz metin komutun herhangi bir yerinde eşleşir; * joker karakterdir; /regex/ düzenli ifadedir.',
  'Allow list': 'İzin listesi',
  'One rule per line. Plain text must match the start of a command (docker ps matches docker ps -a, not docker psx); * and /regex/ work too.':
    'Satır başına bir kural. Düz metin komutun başıyla eşleşmelidir (docker ps, docker ps -a ile eşleşir, docker psx ile değil); * ve /regex/ da çalışır.',
  'Always blocked (built in, cannot be changed)': 'Her zaman engelli (yerleşik, değiştirilemez)',
  'Test a command': 'Bir komutu dene',
  'See what would happen with the rules above (including unsaved edits). Nothing is executed.':
    'Yukarıdaki kurallarla ne olacağını görün (kaydedilmemiş düzenlemeler dahil). Hiçbir şey çalıştırılmaz.',
  Allowed: 'İzinli',
  'Asks you': 'Size sorar',
  Refused: 'Reddedildi',
  Saved: 'Kaydedildi',
  'Unsaved changes': 'Kaydedilmemiş değişiklikler',
  Revert: 'Geri al',
  'Save policy': 'Politikayı kaydet',
  never: 'hiç',
  'just now': 'az önce',
  '{n} s ago': '{n} sn önce',
  '{n} min ago': '{n} dk önce',
  '{n} h ago': '{n} sa önce',
  '{n} d ago': '{n} gün önce',
  'Ask me': 'Bana sor',
  'Every command waits for your approval in a native dialog. Commands on the allow list run immediately (optional).':
    'Her komut yerel bir pencerede onayınızı bekler. İzin listesindeki komutlar hemen çalışır (isteğe bağlı).',
  'Allow list only': 'Yalnızca izin listesi',
  'Only commands that match the allow list may run; everything else is refused. Shell tricks (substitution, redirects) are refused too.':
    'Yalnızca izin listesiyle eşleşen komutlar çalışır; gerisi reddedilir. Kabuk hileleri (komut ikamesi, yönlendirme) de reddedilir.',
  'Anything may run unless it matches the deny list. Convenient, but a deny list can never be complete.':
    'Kara listeyle eşleşmeyen her şey çalışır. Kolaydır ama bir kara liste asla eksiksiz olamaz.',
  'No commands': 'Komut yok',
  'Agents can read status and logs but can never run commands.': 'Ajanlar durum ve logları okuyabilir ama asla komut çalıştıramaz.',
  Read: 'Okuma',
  'Approved by you': 'Sizce onaylandı',
  'Rejected by you': 'Sizce reddedildi',
  Error: 'Hata',
  'Port must be between 1024 and 65535': 'Port 1024 ile 65535 arasında olmalı',
  'Unknown agent': 'Bilinmeyen ajan',
  'Agent name is required': 'Ajan adı gerekli',
  'An agent with this name already exists': 'Bu adda bir ajan zaten var',
  'Too many agents': 'Çok fazla ajan',
  // errors coming from the main process
  'Authentication failed (wrong user, password or key)': 'Kimlik doğrulama başarısız (kullanıcı, şifre veya anahtar hatalı)',
  'Host not found (DNS)': 'Sunucu bulunamadı (DNS)',
  'Connection refused (SSH port closed?)': 'Bağlantı reddedildi (SSH portu kapalı olabilir)',
  'Connection timed out': 'Bağlantı zaman aşımına uğradı',
  'Connection closed': 'Bağlantı kapandı',
  'Command timed out': 'Komut zaman aşımına uğradı',
  'No private key file selected': 'Özel anahtar dosyası seçilmedi',
  'Host key changed! Possible MITM — remove and re-add the server if this is expected.':
    'Sunucu anahtarı değişti! Olası MITM saldırısı — beklenen bir değişiklikse sunucuyu silip yeniden ekleyin.'
}

const catalogues: Record<Lang, Record<string, string>> = { en: {}, tr }

export function resolveLang(pref: Language): Lang {
  if (pref === 'en' || pref === 'tr') return pref
  return (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export const hasTranslation = (lang: Lang, key: string): boolean => lang === 'en' || key in catalogues[lang]

export function translate(lang: Lang, key: string, vars?: Vars): string {
  let s = catalogues[lang][key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

export type TFn = (key: string, vars?: Vars) => string

interface Ctx {
  lang: Lang
  locale: string
  t: TFn
}

const I18nContext = createContext<Ctx>({ lang: 'en', locale: 'en-US', t: (k, v) => translate('en', k, v) })

export function I18nProvider({ pref, children }: { pref: Language; children: ReactNode }) {
  const value = useMemo<Ctx>(() => {
    const lang = resolveLang(pref)
    return { lang, locale: lang === 'tr' ? 'tr-TR' : 'en-US', t: (k, v) => translate(lang, k, v) }
  }, [pref])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = (): Ctx => useContext(I18nContext)
export const useT = (): TFn => useContext(I18nContext).t

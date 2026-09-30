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
  'Start with Windows': 'Windows açılışında başlat',
  'Only works in the installed (packaged) app': 'Yalnızca kurulu (paketlenmiş) uygulamada çalışır',
  'Mini mode always on top': 'Mini mod her zaman üstte',
  'Demo data': 'Demo verisi',
  'Shows fake servers for previewing when none are configured': 'Sunucu eklenmemişken önizleme için sahte sunucular gösterir',
  Language: 'Dil',
  Auto: 'Otomatik',
  'Wallpaper mode is not clickable. Press {key} or use the tray icon to return to the window.':
    'Duvar kağıdı modundayken tıklanamaz. Pencereye dönmek için {key} veya tepsi simgesi.',
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

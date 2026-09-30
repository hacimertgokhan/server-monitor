<div align="center">

# Server Monitor

**Sunucularınız, masaüstünüzde canlı.** **Windows, macOS ve Linux** için, Linux sunucularınızı SSH ile izleyip ortada **siz** olacak şekilde canlı bir akış şeması olarak çizen uygulama: normal pencere, küçük "her zaman üstte" widget veya **masaüstü duvar kağıdı** olarak çalışır. Yapay zekâ ajanları da yerleşik **MCP sunucusu** üzerinden, izinler, izin/kara listeleri ve onaylarla güvenle kullanabilir.

[English](README.md) · [20 sn'lik tanıtım (sesli)](docs/media/promo.mp4) · [hacimertgokhan.com](https://hacimertgokhan.com)

![Tanıtım](docs/media/promo.gif)

</div>

## Özellikler

**İzleme**

- **Sunucu başına canlı kart:** değerler arasında yumuşak geçen CPU / RAM / Disk halkaları, CPU grafiği, ağ hızı, yük, gecikme.
- **Uptime takibi:** sunucu uptime'ı, ölçülen erişilebilirlik (24 sa / 7 gün / 30 gün) ve kesinti sayacı.
- **Docker, PM2, systemd, portlar:** çalışan/toplam konteyner, PM2 süreçleri, çalışan ve hatalı servisler, dışa açık / yerel dinleyen portlar.
- **Açılıp kapanan alt ağaçlar:** kartlardaki Docker / PM2 / Servisler / Portlar rozetine (veya **Tümünü aç**'a) tıklayın: sunucu → grup → tek tek konteyner, süreç, servis ve portlar, sağlık durumuna göre renkli.
- **Loglar:** bir konteynere, PM2 sürecine veya servise tıklayarak loglarını okuyun: vurgulu arama, "yalnızca eşleşenler", hata/uyarı süzgeçleri, canlı yenileme, kopyalama ve kaydetme.
- **Sorunlar paneli ve masaüstü bildirimleri:** çevrimdışı sunucular, süren yüksek CPU/RAM/disk, durmuş konteynerler, hatalı PM2 süreçleri ve servisler; eşikler ayarlanabilir. Yalnızca _yeni_ sorunlar bildirilir. Arama (`/`) ve "yalnızca sorunlular" süzgeci.

**Görünümler**

- **Üç mod:** pencere, mini widget ve masaüstü simgeleriyle sistem duvar kağıdı _arasında_ çalışan **canlı duvar kağıdı**.
- **Serbest veya otomatik yerleşim:** dairesel, ızgara veya serbest; genel kart boyutu ve kart başına boyutlandırma. Her şey hatırlanır.
- **Tepsi / menü çubuğu uygulaması:** pencereyi kapatınca izleme arka planda sürer. Duvar kağıdı modundan `Ctrl+Alt+M` (macOS'ta `⌘⌥M`) ile dönersiniz.
- **Türkçe ve İngilizce** arayüz (otomatik, Ayarlar'dan değiştirilebilir).

**Ajanlar (MCP)**

- Yerleşik **MCP sunucusu**, Claude Code veya Cursor gibi ajanların sunucularınızı listelemesine, durum ve logları okumasına ve izin verirseniz mevcut SSH bağlantılarınız üzerinden komut çalıştırmasına olanak tanır. Aşağıdaki [Ajanlar (MCP)](#ajanlar-mcp) bölümüne bakın.

## Kurulum

[Son sürümden](https://github.com/hacimertgokhan/server-monitor/releases/latest) sisteminize uygun dosyayı indirin:

| Sistem  | Dosya                                           | Notlar                                                                                                                                        |
| ------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | `Server-Monitor-Setup-<sürüm>.exe`              | Kullanıcı bazlı kurulum, yönetici izni gerekmez. SmartScreen onay isteyebilir.                                                                |
| macOS   | `Server-Monitor-<sürüm>-mac-arm64.dmg` / `-x64` | Apple Silicon veya Intel. Uygulama henüz noter onaylı değil: sağ tıklayıp **Aç**'ı seçin ve bir kez onaylayın.                                |
| Linux   | `.AppImage` veya `.deb` (x64)                   | AppImage'a `chmod +x` verip çalıştırın veya `sudo apt install ./dosya.deb`. Parolalar için anahtar zinciri gerekir (GNOME Keyring / KWallet). |

Notlar:

- **Duvar kağıdı modu** Windows ve macOS'ta, Linux'ta ise **X11** oturumunda çalışır. Wayland buna izin vermez, uygulama pencereye döner. Duvar kağıdı tıklanamaz: dönmek için kısayolu veya tepsi simgesini kullanın.
- **Linux tepsisi:** bazı masaüstlerinde (GNOME) tepsi yoktur, bu yüzden orada pencere kapanınca uygulama varsayılan olarak kapanır.
- **Kimlik bilgileri** işletim sistemiyle şifrelenir (Windows DPAPI, macOS Anahtar Zinciri, Linux anahtar zinciri). Linux'ta anahtar zinciri yoksa uygulama parola saklamayı reddeder; parolasız SSH anahtarları yine çalışır.

## Başlangıç

1. **Sunucu ekle** → host, port, kullanıcı ve şifre **veya** SSH özel anahtar dosyası.
2. **Bağlantıyı test et**, sonra **Kaydet**. Kart birkaç saniyede bir güncellenir.
3. Karta tıklayın: Docker, PM2, servisler, portlar, diskler. Kartları sürükleyerek serbest yerleştirin veya üst çubuktan _Otomatik_ / _Izgara_ seçin.
4. Üst çubuktan **Duvar kağıdı**'nı seçin. Geri dönmek için kısayol veya tepsi simgesi → _Pencere modu_.

Sunucusuz denemek için boş ekrandaki **Demo ile önizle**'yi kullanın.

## Ajanlar (MCP)

Üst çubuktaki fiş simgesiyle **Ajanlar (MCP)**'yi açın, açın, bir ajan oluşturun ve tokenını istemcinize verin.

```bash
# Claude Code
claude mcp add --transport http server-monitor http://127.0.0.1:8765/mcp --header "Authorization: Bearer <AJAN_TOKENI>"
```

Araçlar: `list_servers`, `get_server_status`, `list_issues`, `get_policy`, `get_logs` ve (yalnızca izinliyse) `run_command`. Uygulama bağlı ajanları gösterir, her ajanın yetkilerini ve sunucu kapsamını ayarlamanızı sağlar ve her çağrının **etkinlik kaydını** tutar.

**Ajanların ne çalıştırabileceğini siz belirlersiniz:**

| Mod                       | Davranış                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Bana sor** (varsayılan) | Her komut yerel bir pencerede onayınızı bekler. İzin listesindeki tanılama komutları (`uptime`, `df`, `docker ps` …) hemen çalışır. |
| **Yalnızca izin listesi** | Yalnızca izin listesiyle eşleşen komutlar çalışır. Komut ikamesi, yönlendirme ve arka plan işleri doğrulanamadığı için reddedilir.  |
| **Kara liste**            | Kara listede olmayan her şey çalışır. Kolaydır ama kara liste asla eksiksiz olamaz.                                                 |
| **Komut yok**             | Ajanlar yalnızca durum ve log okuyabilir.                                                                                           |

Kurallar düz metin, `*` joker veya `/regex/` olabilir; uygulamada düzenlenir ve ne olacağını gösteren bir **deneme kutusu** vardır. Yıkıcı komutlar (`rm -rf /`, `mkfs`, `dd of=/dev/…`, fork bomb …) **her modda** engellidir ve değiştirilemez.

Güvenlik tasarımı:

- Varsayılan olarak kapalı. Uç nokta yalnızca `127.0.0.1`'e bağlanır, tarayıcı isteklerini (`Origin`) ve beklenmedik `Host` başlıklarını (DNS rebinding) reddeder.
- Ajan başına bir bearer token; yalnızca SHA-256 özeti saklanır, token bir kez gösterilir. Bir ajanı devre dışı bırakmak, yenilemek veya silmek erişimi anında keser.
- Onaylar uygulamanın web görünümünde değil, yerel işletim sistemi penceresinde alınır; bu yüzden ajan kendi kendini onaylayamaz.
- Ajan başına yetkiler (durum / log / komut) ve sunucu kapsamı; zaman aşımı, çıktı sınırı ve eşzamanlı komut sınırı.

## Sunucularınızda ne çalışır?

İzleme, sunucu başına tek kalıcı SSH bağlantısı üzerinden yalnızca okuma komutları kullanır: `/proc/*`, `df`, `docker ps -a`, `pm2 jlist`, `systemctl list-units`, `ss`/`netstat`. Log görüntüleyici, sunucunun kendi bildirdiği adlar için `docker logs`, `pm2 logs --nostream` veya `journalctl -u` çalıştırır.

- Linux sunucular (systemd önerilir). Olmayan araçlar `–` görünür.
- `docker` için kullanıcının `docker` grubunda (veya root) olması gerekir. `pm2`, yalnızca daemon soketi zaten varsa sorgulanır.
- PM2 süreçlerinin ortam değişkenleri anında atılır, asla saklanmaz.
- MCP'yi açıp izin verirseniz bir ajan ek komutlar çalıştırabilir, her zaman politikanız altında.

## Geliştirme

Node.js ≥ 22 gerekir.

```bash
npm install
npm run dev        # Electron, hot reload
npm run dev:web    # yalnız arayüz, tarayıcıda demo veriyle
npm run check      # lint + biçim + tip kontrolü + testler
npm run dist       # bulunduğunuz işletim sistemi için kurulum paketi (dist:win, dist:mac, dist:linux)
npm run promo      # docs/media'yı yeniden üretir
```

Katkıdan önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın. Güvenlik açığı bildirimi için [SECURITY.md](SECURITY.md).

## Yazar ve iletişim

**Hacı Mert Gökhan**

- Web sitesi: [hacimertgokhan.com](https://hacimertgokhan.com)
- E-posta: [hacimertgokhan@gmail.com](mailto:hacimertgokhan@gmail.com)
- GitHub: [@hacimertgokhan](https://github.com/hacimertgokhan)

Hata ve fikirler için: [issue açın](https://github.com/hacimertgokhan/server-monitor/issues/new/choose).

## Lisans

[MIT](LICENSE) © Hacı Mert Gökhan

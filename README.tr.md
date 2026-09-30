<div align="center">

# Server Monitor

**Sunucularınız, masaüstünüzde canlı.** Linux sunucularınızı SSH ile izleyip ortada **siz** olacak şekilde canlı bir akış şeması olarak çizen Windows uygulaması: normal pencere, küçük "her zaman üstte" widget veya **masaüstü duvar kağıdı** olarak çalışır.

[English](README.md) · [20 sn'lik tanıtım (sesli)](docs/media/promo.mp4)

![Tanıtım](docs/media/promo.gif)

</div>

## Özellikler

- **Sunucu başına canlı kart:** değerler arasında yumuşak geçen CPU / RAM / Disk halkaları, CPU grafiği, ağ hızı, yük, gecikme.
- **Uptime takibi:** sunucu uptime'ı, ölçülen erişilebilirlik (24 sa / 7 gün / 30 gün) ve kesinti sayacı.
- **Docker, PM2, systemd, portlar:** çalışan/toplam konteyner, PM2 süreçleri, çalışan ve hatalı servisler, dışa açık / yerel dinleyen portlar.
- **Açılıp kapanan alt ağaçlar:** kartlardaki Docker / PM2 / Servisler / Portlar chip'ine (veya **Tümünü aç**'a) tıklayın: sunucu → grup → tek tek konteyner, süreç, servis ve portlar, sağlık durumuna göre renkli. Uzun listelerde en önemli öğeler önce gelir, kalanı "+N tane daha" düğümüyle açılır. Açık ağaçlar hatırlanır ve duvar kağıdında da görünür.
- **Üç mod:** pencere, mini widget ve masaüstü simgeleriyle sistem duvar kağıdı _arasında_ çalışan **canlı duvar kağıdı** (Windows 10/11, 24H2+ dahil).
- **Serbest veya otomatik yerleşim:** dairesel, ızgara veya serbest; genel kart boyutu kaydırıcısı ve kart başına boyutlandırma. Her şey hatırlanır.
- **Tepsi uygulaması:** pencereyi kapatınca izleme arka planda sürer. Duvar kağıdı modundan `Ctrl+Alt+M` ile dönersiniz.
- **Türkçe ve İngilizce** arayüz (otomatik, Ayarlar'dan değiştirilebilir).
- **Güvenli:** yalnızca okuma komutları, kimlik bilgileri Windows DPAPI ile şifreli, SSH sunucu anahtarı sabitleme.

## Kurulum

[Son sürümden](https://github.com/hacimertgokhan/server-monitor/releases/latest) `Server-Monitor-Setup-<sürüm>.exe` dosyasını indirip çalıştırın (kullanıcı bazlı kurulum, yönetici izni gerekmez). Kurulum dosyası henüz kod imzalı değil; Windows SmartScreen onay isteyebilir.

## Başlangıç

1. **Sunucu ekle** → host, port, kullanıcı ve şifre **veya** SSH özel anahtar dosyası.
2. **Bağlantıyı test et**, sonra **Kaydet**. Kart birkaç saniyede bir güncellenir.
3. Karta tıklayın: Docker, PM2, servisler, portlar, diskler. Kartları sürükleyerek serbest yerleştirin veya üst çubuktan _Otomatik_ / _Izgara_ seçin.
4. Üst çubuktan **Duvar kağıdı**'nı seçin. Geri dönmek için `Ctrl+Alt+M` veya tepsi simgesi → _Pencere modu_.

Sunucusuz denemek için boş ekrandaki **Demo ile önizle**'yi kullanın.

## Sunucularınızda ne çalışır?

Sunucu başına tek kalıcı SSH bağlantısı üzerinden yalnızca okuma komutları: `/proc/*`, `df`, `docker ps -a`, `pm2 jlist`, `systemctl list-units`, `ss`/`netstat`.

- Linux sunucular (systemd önerilir). Olmayan araçlar `–` görünür.
- `docker ps` için kullanıcının `docker` grubunda (veya root) olması gerekir. `pm2`, yalnızca daemon soketi zaten varsa sorgulanır (aksi halde `pm2 jlist` daemon başlatırdı).
- PM2 süreçlerinin ortam değişkenleri anında atılır, asla saklanmaz.

## Geliştirme

Node.js ≥ 22 gerekir.

```bash
npm install
npm run dev        # Electron, hot reload
npm run dev:web    # yalnız arayüz, tarayıcıda demo veriyle
npm run check      # lint + biçim + tip kontrolü + testler
npm run dist       # Windows kurulum paketi (dist/)
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

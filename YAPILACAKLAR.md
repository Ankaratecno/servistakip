# YAPILACAKLAR – Acrob Elektroland Servis Platformu

Kaynak: `YAPILACAKLAR-KAYNAK.txt` (senin attığın dosyanın birebir kopyası).
Sıra yukarıdan aşağı. Her adım öncesi onay alınır, biten adım ✅ ile işaretlenir.

Durum: ⬜ bekliyor · 🟡 devam ediyor · ✅ tamamlandı · ⛔ iptal (istenmedi)

## 1. GPS hız filtresi – dur/kalk sorunu ✅
- ✅ 1.1 `noiseFloor` eşiği düşürüldü: `Math.max(4, (acc1+acc2)*0.4)`
- ✅ 1.2 `MAX_DT` 30 → 600 sn (10 dk bekleme toleransı)
- ✅ 1.3 Uzun bekleme sonrası ilk fix'te GPS'in kendi hızı doğrudan kullanılıyor
- ✅ 1.4 `SPEED_SMOOTHING` 0.35 → 0.45 (daha hızlı tepki)

## 2. Hız tavanı ✅
- ✅ 2.1 `MAX_PLAUSIBLE_KMH` 110 → 160 (gerçek hız kırpılmıyor)

## 3. Stabil hız / km gösterimi ✅
- ✅ 3.1 Anlık hız, ortalama hız, toplam km ve zirve hız hem şoför hem yolcu panelinde aynı kaynaktan gösteriliyor

## 4. Servis Radyosu (USB müzik + PeerJS) ✅
- ✅ 4.1 Şoför paneli: dosya seçici ile çalma listesi (USB'den kopyalanan MP3'ler)
- ✅ 4.2 Web Audio → MediaStreamDestination → `peer.call()` ile yolculara canlı yayın
- ✅ 4.3 Yolcu paneli: gelen stream'i çal, "Şu an çalıyor" kartı + ses aç/kapa
- ✅ 4.4 Kontroller: oynat/duraklat/önceki/sonraki/ses, şarkı bitince otomatik geçiş

## 5. Jingle & Anonslar ✅
- ✅ 5.1 Her 2-3 şarkıda bir "Elektro Radyo" jingle (sıklık ayarlanabilir: 2/3/4/5)
- ✅ 5.2 Saat başı TTS anonsu ("Saat 09:00, Acrob Servis Radyosu")

## 6. Bilgi Yarışması / Düello ⛔ (şimdilik ertelendi – aciliyeti yok)
- ⬜ 6.1 Şoför soruyu yayınlar, yolcular şıkla cevaplar, geri sayım
- ⬜ 6.2 Hız bonusu + streak bonusu ile puanlama
- ⬜ 6.3 Canlı skor tablosu, günlük/haftalık liderlik, durak bazlı skor
- ⬜ 6.4 Düello modu (iki yolcu birebir, 5 soru)

## 7. Hareket Saati (Battery API "kontak" hack'i) ✅
- ✅ 7.1 Şarj başladı = kontak açık → hareket saati kaydı (IndexedDB, günlük)
- ✅ 7.2 Şarj kesildi = duruş; sefer süresi, sefer sayısı, mola süreleri (ss:dd:sn)
- ✅ 7.3 Sağ üst 3 çizgi → "Veriler" panelinde hem şoför hem yolcuda gösterim
- ✅ 7.4 Her durağa varış saati (saat:dakika:saniye) kaydı – 100 m yakınlık
- ✅ 7.5 Kontak API'si olmayan cihazlar için hareket/duruş yedeği (hız tabanlı)
- ✅ 7.6 "Yayını Başlat / Durdur" da hareket kaydını açıp kapatıyor (manuel kaynak)
- ✅ 7.7 Kontak açılınca (telefon şarja girince) yayın otomatik başlıyor – panelden açılıp kapatılabilir

## 8. Kurumsal Raporlar ✅
- ✅ 8.1 Rölanti süresi/oranı, ortalama hız, durak bazlı düzenlilik skoru
- ✅ 8.2 Haftalık sürüş raporu ekranı (`/rapor`, 7/14/30 gün seçimi + günlük döküm)

## 9. "Servis Geliyor" Uyarısı ✅
- ✅ 9.1 500 m kala titreşim, 200 m kala alarm + bildirim


## 10. Ek Deneyim Özellikleri
- ✅ 10.1 Otomatik durak anonsu (TTS + GPS yakınlık) – 350 m, durak başına bir kez
- ✅ 10.2 Ani fren algılama (ivmeölçer + GPS hız düşüşü yedeği)
- ⛔ 10.3 QR kod ile biniş (istenmedi)


## 11. PWA – Native Görünüm (şimdilik atlandı, sonra dönülecek)
- ⬜ 11.1 `manifest.json` + standalone tam ekran, ikon, splash
- ⬜ 11.2 Alt navigasyon barı (Takip / Radyo / Şoför / Duraklar)
- ⬜ 11.3 Parmakla sağa-sola geçiş (swipe), kaydırma barı gizli

## 12. 3D Harita ✅
- ✅ 12.1 Leaflet → MapLibre GL JS geçişi (3D binalar, pitch/bearing)

## 13. Hava Durumu ✅
- ✅ 13.1 Open-Meteo (anahtarsız, ücretsiz) ile güzergâh hava durumu

## 14. Geçilen Durak/Rota Temizliği ✅
- ✅ 14.1 Hassas "tam varış" (GPS doğruluğuna göre 15-35 m) + duraktan uzaklaşma şartıyla "geçildi"; durak ve geçilen rota parçası haritadan otomatik siliniyor

## 15. Kopma Sonrası Devam ✅
- ✅ 15.1 Son geçilen durak IndexedDB'ye kaydediliyor
- ✅ 15.2 Yeniden yayında "Kaldığım yerden devam et / Baştan başla" seçeneği

---

### Güncelleme Günlüğü
- ✅ Adım 1 + 2 tamamlandı — `src/lib/trip-stats.ts`: dur/kalk sonrası hız artık "Sıfırla" butonuna basmadan güncelleniyor, 110 km/s tavanı 160'a çıkarıldı.
- ✅ Adım 3 tamamlandı — anlık/ortalama/toplam km zaten aynı filtreden geliyordu; eksik olan zirve hız da yolculara yayınlanıp panelde gösterildi.
- ✅ Adım 4 tamamlandı — `src/components/DriverRadio.tsx` (şoför çalma listesi + canlı yayın), `src/lib/radio.ts` (radyo durum paketi), yolcu panelinde "Şu an çalıyor" kartı, ses açma ve seviye ayarı. Yayına sonradan katılan yolcular da otomatik bağlanıyor.
- ✅ Adım 5 tamamlandı — `src/lib/jingle.ts` (riser + sub impact + elektro arp + akor stab sentezi), `src/assets/jingle-1..3.mp3` (AI ile üretilmiş derin radyo spikeri istasyon anonsları), `src/lib/tts.functions.ts` (saat başı anonsu için sunucu tarafı TTS). Jingle şarkı aralarında otomatik çalıyor, müzik kısılıyor ve yolculara canlı gidiyor.
- ⛔ Adım 6 (Bilgi Yarışması) istek üzerine ertelendi; istenildiği an eklenebilir.
- ✅ Adım 7 tamamlandı — `src/lib/journey-log.ts` (günlük IndexedDB kaydı: kontak seansları, mola süreleri, durak varış saatleri), `src/components/DataSheet.tsx` (sağ üst 3 çizgi → "Veriler" kayan paneli, şoförde 14 günlük geçmiş + sıfırlama). Şoför kaydı yolculara canlı gönderiliyor; yolcu da aynı "Veriler" panelinden görüyor. Durak varış saatleri 8. maddedeki düzenlilik skorunun veri temeli.
- ✅ Adım 7 eki — hareket kaydı artık 3 kaynaktan tetikleniyor: Battery API (kontak), "Yayını Başlat/Durdur" ve hız tabanlı yedek. Kontak açılınca yayın otomatik başlıyor (şoför panelindeki anahtarla kapatılabilir).
- ✅ Adım 8 tamamlandı — `src/routes/rapor.tsx`: toplam km, ortalama hız, rölanti süresi/oranı, sefer & mola süreleri, durak bazlı düzenlilik skoru (varış saatlerinin günler arası sapması) ve günlük döküm. Şoför panelinden "→ Haftalık Sürüş Raporu" ile açılıyor.
- ✅ Adım 9 tamamlandı — `src/lib/approach-alert.ts` (500 m / 200 m eşikleri, tek seferlik tetikleme, 800 m'de sıfırlama, Web Audio alarmı, bildirim izni) ve yolcu panelinde "Servis Geliyor Uyarısı" kartı: 500 m kala titreşim + bildirim, 200 m kala uzun titreşim + alarm sesi + TTS anonsu + bildirim. Aç/kapa tercihi localStorage'da kalıcı.

- ✅ Adım 10 tamamlandı — `src/lib/announce.ts`: 350 m yakınlıkta otomatik durak anonsu (TTS, durak başına tek sefer, 700 m sonra sıfırlanır) ve ani fren algılama (DeviceMotion ivmeölçer 0.35 g orta / 0.55 g sert, ivmeölçer yoksa GPS hız düşüşü yedeği). Olaylar şoför panelinde ve yolcu panelinde canlı listelenir; anons şoförde ve yolcuda sesli okunur (SESLİ/SESSİZ anahtarı). 10.3 QR kod ile biniş istek üzerine iptal.

- ✅ Adım 12 tamamlandı — `src/components/MapView.tsx` MapLibre GL JS ile yeniden yazıldı: OpenFreeMap "dark" vektör stili (anahtar gerekmez), 13. zoom'dan sonra `fill-extrusion` ile 3D binalar, varsayılan 55° pitch / -20° bearing, sağ tıkla veya iki parmakla döndürme, sağ üstte pitch göstergeli navigasyon kontrolü, sol üstte "3D/2D Görünüm" ve "Kuzeye Dön" düğmeleri. Rota GeoJSON line + casing olarak, duraklar/servis aracı DOM marker olarak çiziliyor; tüm props (`stops`, `busPosition`, `routePath`, `onMapClick`) aynı kaldı, admin/şoför/yolcu panelleri değişmeden çalışıyor. `vite.config.ts`'e `optimizeDeps.exclude: ["maplibre-gl"]` eklendi (worker yükleme hatası için).

- ✅ Adım 13 tamamlandı — `src/lib/weather.ts` (Open-Meteo current API, anahtarsız/ücretsiz) ve `src/components/WeatherCard.tsx`: servis aracının anlık konumundaki sıcaklık, hissedilen, hava durumu açıklaması/ikonu, rüzgâr, nem, yağış ve sürüş uyarısı (kar/buzlanma, ıslak zemin, sis, kuvvetli rüzgâr). Şoför panelinde kendi GPS konumundan, yolcu panelinde şoförden gelen canlı konumdan; ~2 km yer değişiminde veya 10 dakikada bir yenilenir.

- ✅ Adım 14 tamamlandı — `src/lib/passed-stops.ts`: iki aşamalı hassas tespit. 1) Araç durağın GPS doğruluğuna göre belirlenen 15-35 m'lik yarıçapına girince "ulaşıldı", 2) yarıçaptan +25 m uzaklaşınca "geçildi" kesinleşir ve durak haritadan kalkar. `trimRoutePath` ile rotanın araca en yakın noktasına kadar olan kısmı kırpılır (araç rotadan 80 m'den fazla saparsa kırpma yapılmaz). Hem şoför hem yolcu paneli aynı mantığı kullanır. Not: GPS'te matematiksel 0 m mümkün olmadığı için "tam 0 metre" yerine bu yöntem çok daha stabil çalışır.
- ✅ Adım 15 tamamlandı — `src/lib/resume.ts`: 14. maddedeki hassas "geçildi" tespitinden gelen son durak (id, ad, sıra, saat) IndexedDB'ye yazılır. Şoför paneli yayın başlatma ekranında 12 saatten yeni bir kayıt varsa "Yarım Kalan Sefer" kartı çıkar: **Kaldığım yerden devam et** güzergâhı o durağın bir sonrasından başlatır, **Baştan başla** kaydı siler ve listenin ilk noktasına döner.

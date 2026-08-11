# YAPILACAKLAR3 – Derin Analiz (son depo: commit 4b88a65 · 11.08.2026)

Depo baştan aşağı yeniden okundu (`trip-stats.ts`, `driver.tsx`, `index.tsx`, `DriverRadio.tsx`,
`approach-alert.ts`, `announce.ts`, `peer-config.ts`, `radio.ts`, `wake-lock.ts`, `routing.ts`).
YAPILACAKLAR2'de ✅ olan 1–19 doğrulandı. Aşağıdakiler **hâlâ açık** bulgular.
Durum: ⬜ bekliyor · 🟡 devam ediyor · ✅ tamamlandı · ⛔ iptal

Öncelik sırası: **A → C → B → D → F → E → G**

---

## A. Hız / km takılmaları (önceki 6 madde + yeni tespitler)
- ✅ 1. **Kalp atışı (heartbeat) yok.** `position` paketi yalnızca GPS fix geldiğinde gönderiliyor (`driver.tsx:563`). Sinyal kesilince yolcu ekranı son hızı sonsuza kadar gösteriyor — "takılma" hissinin 1 numaralı sebebi. 1 sn'lik timer ile son paket + `ageMs` gönderilmeli.
- ✅ 2. **Veri yaşı göstergesi yok.** Yolcuda "3 sn önce güncellendi" ve >10 sn'de hızın soluklaşıp `—` olması gerekir; şu an bayat veri canlı veri gibi duruyor.
- ✅ 3. **İvme kapısı simetrik.** `MAX_ACCEL_KMH_PER_S = 8` (trip-stats.ts) frenlemeyi de reddediyor; sert frende hız yüksek değerde kilitleniyor. Yavaşlama için ~15, hızlanma için ~6 ayrı eşik.
- ✅ 4. **Zayıf fix'te gürültü tabanı çok yüksek.** `(acc+prevAcc)*0.6` → 90 m fix'te 108 m eşik; şehir içi gerçek hareket "gürültü" sayılıp sayaç ve hız donuyor. Tabana üst sınır (≈35–40 m) konmalı, GPS hızı hareketi teyit ediyorsa taban esnetilmeli.
- ✅ 5. **`watchPosition` watchdog'u yok.** Android Chrome hata callback'i çağırmadan fix göndermeyi bırakabiliyor. 15 sn fix yoksa `clearWatch` + yeniden `watchPosition`, 3 denemede düşük hassasiyete düşme.
- ✅ 6. **`dt < 1 sn` fixler tamamen atılıyor.** Android çoğunlukla ~0.9 sn üretiyor → veri kaybı ve gecikme. Eşik 0.4 sn'ye inmeli veya atılan fix'ler biriktirilmeli (accumulate).
- ✅ 7. **`Math.min(gps, segKmh)` hızı sistematik düşük gösteriyor.** Hızlanmada GPS Doppler hızı daha doğrudur; segment hızı yalnızca tutarlılık kontrolü için kullanılmalı.
- ✅ 8. **EMA zamandan bağımsız.** `SPEED_SMOOTHING = 0.45` sabit; 1 sn ile 5 sn arası fix aynı ağırlıkta → tepki tutarsız. Zaman tabanlı EMA: `1 - exp(-dt/tau)`.
- ✅ 9. **Zayıf fix'te zirve hız hiç güncellenmiyor.** Şehirler arası zayıf sinyalde gerçek zirve kaybediliyor; GPS hızı segment hızını teyit ediyorsa zayıf fix'te de kabul edilmeli.
- ✅ 10. **`maximumAge: 0` + `timeout: 20000` + yüksek hassasiyet** bazı cihazlarda sürekli TIMEOUT döngüsü üretiyor; yedek olarak paralel düşük hassasiyetli watch.
- ✅ 11. **`GAP_DT` (90 sn) sonrası hız GPS hızına sıçrıyor**, EMA sıfırlanmıyor; kısa bir "kalibre ediliyor" durumu gösterilmeli.

## B. PeerJS / bağlantı dayanıklılığı
- 🟡 12. **Sabit tek `DRIVER_PEER_ID`.** İki cihaz/sekme kilitlenmeye yol açıyor; oturum kimliği (plaka+tarih+rastgele) + yolcuya kimlik keşfi (küçük bir liste/ilan kanalı) daha sağlam.
- ✅ 13. **`beforeunload`/`pagehide`'da `peer.destroy()` yok.** Kimlik sunucuda 1–2 dk asılı kalıyor, şoför "kimlik devralınıyor…" ekranında bekliyor.
- ✅ 14. **Yolcuda `peer.on("disconnected")` → `peer.reconnect()` yok.** Signaling düşünce `peer.connect()` sessizce başarısız oluyor, sonsuz "bağlanıyor".
- ✅ 15. **Bağlantı zaman aşımı yok.** `conn.on("open")` hiç gelmezse durum sonsuz "connecting"; 10 sn'de open olmazsa kapat + yeniden dene.
- ✅ 16. **ICE durumu izlenmiyor.** `iceConnectionState = failed/disconnected` olduğunda ICE restart yapılmalı; şu an "açık ama veri akmayan" zombie bağlantı tespit edilmiyor.
- ✅ 17. **Heartbeat/pong ile ölü bağlantı temizliği yok.** Şoför panelindeki "N yolcu" gerçeği yansıtmıyor (kopan tünel bağlantıları sayılmaya devam ediyor).
- ✅ 18. **Tek ücretsiz TURN (openrelay).** Kota/kapanma riski tek nokta; ikinci TURN sağlayıcı + açılışta TURN erişilebilirlik testi ("bağlantı türü: TURN/röle" rozeti).
- ✅ 19. **Yeniden bağlanma arka planda da sürüyor** (batarya); sekme gizliyken duraklatılıp geri dönünce anında tek deneme yapılmalı.
- ✅ 20. **Ölçeklenme:** her yolcu ayrı WebRTC bağlantısı; 15+ yolcuda şoför telefonu ısınıyor ve paket kaybı artıyor. Yayın periyodu + delta + duruşta seyreltme şart (bkz. E).

## C. Radyo (sonradan giren yolcu, ses güvenilirliği)
- ✅ 21. **`callEveryone()` her `play`/jingle'da yeniden `peer.call` yapıyor** (`DriverRadio.tsx:86`) → aynı yolcuya birden çok MediaConnection; eskiler kapatılmıyor: çift ses/eko, bellek sızıntısı. Peer başına tek aktif call haritası tutulmalı.
- ✅ 22. **Yolcu tarafında yeni `call` gelince eskisi kapatılmıyor** (`index.tsx:271`), yalnızca `srcObject` üzerine yazılıyor.
- ✅ 23. **Şoför yayına sonra başlarsa mevcut yolculara call atılmıyor.** `radioStreamRef` oluştuğu anda *tüm* açık bağlantılara call gerekir; şu an sadece yeni bağlanana yapılıyor (`driver.tsx:438`).
- ✅ 24. **Sonradan giren yolcu için call yeniden denenmiyor.** İlk call ICE'de düşerse sessizlik kalıcı; 5 sn içinde "stream geldi mi" kontrolü + tekrar çağrı.
- ✅ 25. **iOS/Safari autoplay:** `<audio muted={!radioOn}>` başlangıçta sessiz, yolcu butona basmazsa hiç duymaz. "Yayın var — sesi açmak için dokun" şeklinde belirgin, kalıcı çağrı gerekir.
- 🟡 26. **`createMediaElementSource` + `MediaStreamDestination` zinciri iOS Safari'de sessiz akış üretebiliyor.** Yedek yol: `audioEl.captureStream()` veya sunucu tabanlı (Icecast/HLS) yayın.
- ✅ 27. **"Yolcular duyuyor mu" geri bildirimi yok.** Yolcudan `audio-ok` pong'u alınıp panelde "N/M dinliyor" gösterilmeli.
- ✅ 28. **Parça listesi blob URL (yerel dosya).** Sayfa yenilenince liste gidiyor; yolcuya başlık/indeks gitmeye devam ediyor ama ses yok — tutarsız durum.
- ✅ 29. **Yolcu tarafında anons sırasında radyo kısılmıyor** (duck sadece şoförde). TTS ile müzik üst üste biniyor.
- ✅ 30. **TTS kuyruğu yok** (YAPILACAKLAR2 #23 hâlâ açık): durak anonsu + fren + saat anonsu aynı anda konuşabiliyor.
- ✅ 31. **`alarmTone()` her çağrıda yeni `AudioContext` açıyor** (`approach-alert.ts`); iOS'ta birkaç açılıştan sonra tamamen sessizleşiyor. Tek paylaşılan context.

## D. Durak mesafesi ve uyarı zamanlaması ("erken uyarı" sorunu)
- ✅ 32. **Uyarılar kuş uçuşu (haversine) mesafeye dayalı.** Dolambaçlı güzergâhta 500 m kuş uçuşu = 1,5 km yol → uyarı çok erken. Yol mesafesi (OSRM) veya güzergâh çizgisi üzerinden ölçüm gerekir.
- ✅ 33. **Sabit metre eşiği yerine ETA (süre) tabanlı uyarı**: "5 dk kaldı / 2 dk kaldı / kapıda". Trafikte 500 m 4 dk, boş yolda 30 sn.
- ✅ 34. **Yön (bearing) kontrolü yok.** Servis duraktan uzaklaşırken ya da paralel sokaktan geçerken de "geliyor" uyarısı çıkıyor.
- ✅ 35. **`ANNOUNCE_M = 350` tüm duraklar için sabit**, hızdan bağımsız: 70 km/s'de 18 sn kalır (geç), 15 km/s'de 84 sn (erken). Hıza göre dinamik eşik.
- ✅ 36. **Kritik: yakın duraklarda uyarı atlanıyor.** `ANNOUNCE_RESET_M = 700` / `RESET_M = 800`; iki durak arası 700 m'den azsa kilit sıfırlanamıyor, ikinci durak için anons/uyarı hiç çalışmıyor. Sıfırlama mesafeye değil "durak geçildi" olayına bağlanmalı.
- ✅ 37. **Uyarı hedefi tüm duraklar üzerinde dönüyor** (`driver.tsx:525`); geride kalan durak yeniden tetiklenebiliyor. Yalnızca "sıradaki durak" değerlendirilmeli (`passed-stops` ile ortak).
- ✅ 38. **iOS'ta `Notification` ve `navigator.vibrate` yok** → uyarı sessizce kayboluyor. Görsel tam ekran flaş + ses yedeği şart.
- ✅ 39. **OSRM public demo'da timeout/debounce/limit yedeği yok** (YAPILACAKLAR2 #27 açık): ETA `—` kalıyor. Kalan mesafe × son ortalama hız ile yerel yedek hesap.
- ✅ 40. **Uyarı geçmişi yok.** Yolcu ekranı arkadayken uyarıyı kaçırırsa iz kalmıyor; "son uyarılar" listesi + saat.

## E. Veri / batarya (YAPILACAKLAR2'den devreden)
- ⬜ 41. Tüm `DayLog` JSON'u her değişimde tüm yolculara gönderiliyor (`driver.tsx:323`) — delta gönderilmeli.
- ⬜ 42. Yayın periyodu sabit; duruşta seyrekleşmiyor.
- ⬜ 43. IndexedDB yazımı `applyDay` içinde her fix'te — toplu (batch) yazım.

## F. Güvenlik / servis
- ⬜ 44. **`DRIVER_PASSWORD = "ankara06"` istemci paketinde açık metin.** Herkes şoför paneline girip yayın kimliğini kapabilir ve sahte konum yayınlayabilir. Sunucu tarafı doğrulama / imzalı oturum tokenı gerekir.
- ⬜ 45. **Yolcudan gelen `alert` paketi doğrulanmıyor** (`driver.tsx:446`): herhangi bir peer şoföre ses/metin gönderip hoparlörü kullanabilir. Zod şeması + peer başına hız sınırı + susturma.
- ⬜ 46. **Yolcu tarafında gelen paketler şema doğrulaması olmadan state'e yazılıyor** (`index.tsx:222`) — bozuk/kötü niyetli paket ekranı kilitleyebilir.
- ⬜ 47. **`getBattery` yalnızca Chrome'da var**; "kontak" otomatik başlatma iOS/Firefox'ta sessizce çalışmıyor, kullanıcıya bilgi verilmiyor.

## G. Kullanıcı deneyimi (üst seviye için)
- ⬜ 48. **PWA/Service Worker yok**: tünelde/kapsama boşluğunda sayfa yenilenirse uygulama açılmıyor; offline kabuk + son bilinen konum önbelleği.
- ⬜ 49. **Şoför için "yayın sağlığı" tek bakış paneli**: GPS ±m, fix yaşı, yolcu sayısı, TURN/röle durumu, radyo dinleyen sayısı — tek satırda.
- ⬜ 50. **Yolcu ilk açılış deneyimi**: tek dokunuşla "sesi aç + bildirim izni + durak seç" onboarding; şu an izinler dağınık.
- ⬜ 51. **Erişilebilirlik/okunurluk**: hız ve ETA sürüşte tek elle, güneş altında okunacak kadar büyük değil; gece modu ayrımı zayıf.

## H. Şoför "çevrimdışı" görünme / yolcu yeniden deneme (yeni tespit – 11.08.2026)
- ⬜ 52. **Yolcu bağlantıyı yalnızca bir kez deniyor.** Yolcu sayfayı şoför henüz açmadan açtığında `peer.connect(DRIVER_PEER_ID)` "peer-unavailable" hatası alıyor ve durum kalıcı "çevrimdışı" oluyor. Şoför sonradan girdiğinde yeniden deneme olmadığı için ancak sayfa yenilenirse bağlanıyor. Çözüm: `peer-unavailable` hatasında **sürekli yeniden deneme döngüsü** (3 sn → 5 sn → 10 sn üst sınırlı backoff, sonsuz; sekme gizliyken duraklat, geri dönünce anında tek deneme).
- ⬜ 53. **Presence (varlık) kanalı yok.** Yolcu şoförün çevrimiçi olup olmadığını sadece bağlanmayı denemekten anlıyor. Çözüm: hafif bir "ilan" mekanizması — şoför açıkken 5 sn'de bir `driver-online` yayını (veya Cloud'da `is_live` satırı / Realtime presence). Yolcu bunu görünce hemen bağlanır.
- ⬜ 54. **"Çevrimdışı" durumu ile "bağlantı kurulamıyor" ayrımı yok.** Yolcu ekranı üç ayrı durum göstermeli: *şoför yayında değil* · *yayında, bağlanılıyor (n. deneme)* · *bağlı*. Ayrıca "Tekrar dene" butonu ve "son deneme: 3 sn önce" bilgisi.
- ⬜ 55. **Şoför tarafında `peer.destroy()` yapılmadığı için kimlik asılı kalıyor** (bkz. 13) → yolcu "çevrimiçi" sanıp veri alamıyor (zombie). Presence zaman aşımı (>15 sn paket yoksa çevrimdışı say) gerekli.
- ⬜ 56. **Şoför kimliği değişirse yolcu haberi olmuyor** (12 ile birlikte): oturum kimliğine geçilirse yolcunun keşif kanalından yeni kimliği alması şart.
- ⬜ 57. **`visibilitychange` / `online` olaylarında anında yeniden deneme yok.** Telefon uykudan kalkınca veya ağ döndüğünde yolcu 30+ sn boş ekran görüyor.

## I. Uygulamayı "üst seviye" yapacak ek fikirler
- ⬜ 58. **Canlı harita üzerinde servis rozeti**: aracın ikonu + yön oku + hız etiketi, durak pinlerinde "kalan süre" balonu.
- ⬜ 59. **"Beni al" / durak seçimi hafızası**: yolcu durağını seçince kalıcı saklanır, açılışta doğrudan "durağınıza 4 dk" ekranı.
- ⬜ 60. **Sesli/titreşimli akıllı uyandırma**: yolcu telefonu kilitli olsa bile 2 dk kala uyarı (bildirim + ses yedeği, iOS için tam ekran flaş).
- ⬜ 61. **Sefer geçmişi ve karne**: gün sonunda km, ortalama/zirve hız, durak bekleme süreleri, gecikme grafiği; paylaşılabilir özet.
- ⬜ 62. **Şoför için tek dokunuş modları**: "Sefer başladı / Mola / Sefer bitti" — GPS, radyo ve yayın periyodu otomatik ayarlanır.
- ⬜ 63. **Yolcu → şoför hızlı mesajlar**: "Durakta bekliyorum", "Bugün binmiyorum" (hazır butonlar, spam koruması ile) → şoför boş durakta durmaz.
- ⬜ 64. **Veli/kurum ekranı**: sadece okuma modunda çoklu araç takibi, link ile paylaşım.
- ⬜ 65. **Bağlantı kalitesi rozeti**: P2P / röle (TURN), gecikme ms, paket yaşı — hem şoförde hem yolcuda tek satır.
- ⬜ 66. **Çevrimdışı kabuk (PWA) + son bilinen konum** (48 ile birlikte): tünelde sayfa yenilenirse en az son durum görünür.
- ⬜ 67. **Tema ve okunurluk**: gündüz/gece otomatik, sürüş modunda dev hız/ETA tipografisi, tek elle erişilebilir buton yerleşimi.
- ⬜ 68. **Çoklu güzergâh/araç desteği**: plaka+güzergâh seçimi, her araç için ayrı yayın kimliği.

---

### Özet – en çok fayda getirecek 10 madde
1, 2, 3, 4, 5 (hız takılmaları) · 21, 23, 25 (radyo sonradan giren + iOS ses) · 36 (atlanan durak uyarısı) · **52–53 (şoför çevrimdışı görünme / otomatik yakalama)**

### Güncelleme Günlüğü
- ✅ **A bölümü (1–11) tamamlandı** — 11.08.2026
  - 1: `driver.tsx` içinde 1 sn'lik kalp atışı; son `position` paketi `fixTs` + `ageMs` ile sürekli gönderiliyor.
  - 2: Yolcuda "n sn önce güncellendi"; 10 sn üstünde hız soluklaşıp `—` oluyor, durum "Veri bekleniyor".
  - 3: Asimetrik ivme kapısı (hızlanma 6, fren 15 km/s/s) ve red yerine kapıya sıkıştırma → frende hız kilitlenmiyor.
  - 4: Gürültü tabanına 38 m üst sınır; GPS hızı hareketi teyit ederse taban yarıya iniyor.
  - 5: 15 sn fix gelmezse `clearWatch` + yeniden `watchPosition` (watchdog).
  - 6: `MIN_DT` 1 sn → 0.4 sn; Android'in ~0.9 sn fixleri artık atılmıyor.
  - 7: GPS Doppler hızı esas alınıyor, segment hızı yalnızca tutarlılık kontrolü.
  - 8: Zaman tabanlı EMA (`1 - exp(-dt/tau)`, tau = 2.2 sn).
  - 9: Zayıf fix'te de GPS teyidi varsa zirve hız güncelleniyor.
  - 10: 3 başarısız watchdog denemesinden sonra düşük hassasiyetli watch'a düşülüyor.
  - 11: Uzun boşluk sonrası 4 sn "kalibre ediliyor" durumu (hem şoför hem yolcu ekranında).
- ✅ **B bölümü (13–20) tamamlandı, 12 beklemede** — 11.08.2026
  - 12: 🟡 Sabit `DRIVER_PEER_ID` korundu. Oturum kimliği ancak bir keşif/ilan kanalıyla anlamlı; bu H bölümü (52–53, presence) ile birlikte yapılacak.
  - 13: `pagehide`/`beforeunload` içinde `peer.destroy()` zaten mevcut, doğrulandı.
  - 14: Yolcuda `peer.on("disconnected")` → `peer.reconnect()`.
  - 15: `CONN_OPEN_TIMEOUT_MS = 10 sn`; açılmayan bağlantı kapatılıp yeniden deneniyor.
  - 16: `watchIceState()` ile ICE `failed`/`disconnected` izleniyor; önce `restartIce()`, olmazsa bağlantı düşürülüyor (zombie temizliği, iki tarafta da).
  - 17: 5 sn'de bir `ping`, yolcudan `pong`; 20 sn pong gelmezse bağlantı ölü sayılıp kapatılıyor → "N yolcu" artık gerçek.
  - 18: İkinci ücretsiz TURN sağlayıcı (freeturn.net) eklendi + açılışta `checkTurnReachable()` ile röle testi ve şoför panelinde rozet.
  - 19: Sekme gizliyken yeniden bağlanma duraklatılıyor; `visibilitychange`/`online` olayında anında tek deneme.
  - 20: Araç dururken (<2 km/s) yayın periyodu 1 sn → 3 sn'ye seyreltiliyor (veri + batarya + çok yolcuda ısınma).
- ✅ **D bölümü (32–40) tamamlandı** — 12.08.2026
  - Yeni `src/lib/route-progress.ts`: güzergâh çizgisi üzerinden yol mesafesi, bearing/eğilim kontrolü, hıza göre dinamik anons eşiği (~25 sn'lik yol, 150–700 m), yerel ETA hesabı, "sıradaki durak" seçimi.
  - 32: Anons/uyarı mesafesi rota çizgisi boyunca ölçülüyor (kuş uçuşundan asla kısa değil).
  - 33: Yolcu uyarıları ETA tabanlı: 5 dk (titreşim) · 2 dk (alarm + konuşma + bildirim) · kapıda (son uyarı).
  - 34: Uzaklaşma eğilimi (üst üste 3 ölçüm) veya heading farkı >110° ise uyarı üretilmiyor.
  - 35: `announceDistanceM(hız)` ile dinamik eşik; sabit 350 m kaldırıldı.
  - 36: `ANNOUNCE_RESET_M` kaldırıldı; kilit `resetAnnounce()` ile durak geçilince açılıyor → yakın duraklar artık atlanmıyor.
  - 37: Şoförde yalnızca `nextStop()` (geçilmemiş ilk gerçek durak) değerlendiriliyor.
  - 38: Bildirim izni yoksa/iOS'ta tam ekran flaş + `alarmTone()`; dokununca kapanıyor.
  - 39: OSRM isteklerinde 7 sn zaman aşımı; başarısızsa rota mesafesi × ortalama hız ile "YEREL TAHMİN" etiketli ETA.
  - 40: Uyarı geçmişi localStorage'da (son 12), yolcu Uyarı sekmesinde saatli liste + temizle.

# YAPILACAKLAR2 – Kullanıcı Deneyimi Bulguları (28 madde)

Analizde tespit edilen 28 bulgu. Sıra yukarıdan aşağı, biten madde ✅ ile işaretlenir.
Durum: ⬜ bekliyor · 🟡 devam ediyor · ✅ tamamlandı · ⛔ iptal

## A. Kritik – Yayın kopması / arka plan ✅
- ✅ 1. Ekran kilidi: `navigator.wakeLock` yok, ekran kapanınca GPS + yayın duruyor
- ✅ 2. Sekme arka plana alınınca (visibilitychange) yayını toparlama / yeniden başlatma
- ✅ 3. PeerJS için TURN/ICE sunucuları tanımlı değil (mobil operatör NAT'ında bağlantı kurulmuyor)
- ✅ 4. Yeniden bağlanma sabit 4 sn – kademeli (exponential backoff) olmalı
- ✅ 5. Sabit `DRIVER_PEER_ID` çakışması: eski oturum kapanmazsa "ID alınamadı" kilidi
- ✅ 6. Bağlantı durumu kullanıcıya gösterilmiyor (bağlanıyor / koptu / hata rozeti)
- ✅ 7. Yolcu tarafında yayın yoksa "şoför yayında değil" ayrımı yapılmıyor

## B. Km sayacı / GPS ✅
- ✅ 8. 30 m doğruluk eşiği katı: şehir içi kötü sinyalde sayaç tamamen donuyor (yedek eşik gerek)
- ✅ 9. `MAX_DT` 600 sn: arka plandan dönüşte tek adımda büyük km sıçraması
- ✅ 10. Duruşta EMA sıfıra tam inmiyor, "1-2 km/s" hayalet hız
- ✅ 11. Ortalama hız `movingSeconds` şişince düşük kalıyor (duruş süresi ayıklanmalı)
- ✅ 12. Zirve hız `fastStreak` mantığı yavaş ivmede zirveyi kaçırıyor
- ✅ 13. GPS izni reddedilince / sinyal yokken kullanıcıya net uyarı yok
- ✅ 14. `watchPosition` seçenekleri (timeout / maximumAge) ayarlı değil, takılı fix

## C. Harita performansı (kasma) ✅
- ✅ 15. Her fix'te `easeTo` kamera animasyonu – hareketli haritada kasma
- ✅ 16. Marker'lar her render'da yeniden oluşturuluyor (DOM çöpü)
- ✅ 17. Rota kırpma her tick'te O(n) – throttle + son indeksten devam
- ✅ 18. 3D bina katmanı düşük cihazlarda kapanamıyor (performans anahtarı yok)
- ✅ 19. Harita görünmezken (sekme arka planda) render devam ediyor

## D. Veri / batarya
- ⬜ 20. Tüm `DayLog` JSON'u saniyede bir yayınlanıyor – delta gönderilmeli
- ⬜ 21. Yayın periyodu sabit; duruşta seyrekleşmiyor
- ⬜ 22. IndexedDB yazımı her fix'te – toplu (batch) yazım gerek

## E. Ses / anons
- ⬜ 23. TTS anonsları üst üste biniyor (kuyruk / iptal yok)
- ⬜ 24. Anons sırasında radyo müziği kısılmıyor (yolcu tarafında)
- ⬜ 25. Alarm/jingle için AudioContext her seferinde yeniden açılıyor (iOS'ta sessiz kalma)

## F. Güvenlik / servis
- ⬜ 26. Şoför şifresi kodda açık metin (`driver-auth.ts`)
- ⬜ 27. OSRM public demo: timeout + debounce + hata yedeği yok (ETA patlıyor)
- ⬜ 28. Open-Meteo / OSRM isteklerinde çevrimdışı (offline) yedeği yok

---

### Güncelleme Günlüğü
- ✅ Bulgu 1-7 tamamlandı — `src/lib/wake-lock.ts` (Screen Wake Lock + arka plandan dönüşte yeniden alma), `src/lib/peer-config.ts` (STUN + ücretsiz TURN sunucuları, kademeli yeniden bağlanma gecikmesi 2s→30s). Şoför panelinde yayın açıkken ekran kilidi devrede, arka plandan dönüşte `peer.reconnect()` çalışıyor, üstte "Yayın açık · N yolcu / Ekran açık tutuluyor" rozeti var. Kimlik devralma 6→8 denemeye çıkarıldı ve kademeli bekleme kullanıyor. Yolcu panelinde durum artık üçe ayrılıyor: "Şoför Yayında Değil" (yayın yok), "Bağlantı Koptu" (ağ hatası), "Canlı" + yeniden deneme sayacı.
- ✅ Bulgu 8-14 tamamlandı — `src/lib/trip-stats.ts`: doğruluk eşiği iki kademeli (≤35 m iyi, ≤90 m zayıf → mesafe yazılır ama zirve hız güncellenmez, >90 m atılır) böylece sayaç kötü sinyalde donmuyor; 90 sn'den uzun GPS boşluğunda mesafe yazılmıyor (arka plandan dönüşte km sıçraması bitti); 3 km/s altı hız tam sıfıra çekiliyor (hayalet hız gitti); `movingSeconds` yalnızca fiilî hareketi sayıyor (ortalama hız artık doğru); zirve hız 2 doğrulanmış ölçümde, GPS teyidi varsa 1 ölçümde güncelleniyor. `src/routes/driver.tsx`: `watchPosition` artık `maximumAge: 0`, `timeout: 20000` (takılı/bayat fix yok), GPS hataları izin/sinyal/zaman aşımı olarak ayrıştırılıp panelde yazılıyor ve yeni rozette "GPS ±N m / GPS zayıf / GPS sinyali kötü" canlı gösteriliyor.
- ✅ Bulgu 15-19 tamamlandı — `src/components/MapView.tsx`: her GPS fix'inde `easeTo` yerine tek bir `requestAnimationFrame` döngüsü kamerayı yumuşakça kaydırıyor (kasma bitti, zoom/eğim/kadraj yalnızca takip açılırken bir kez ayarlanıyor); durak işaretçileri artık `Map<id, marker>` ile yeniden kullanılıyor, yalnızca değişen güncelleniyor (DOM çöpü yok); rota kırpma `useTrimmedRoutePath` ile 1.2 sn throttle + son indeksten dar pencere aramasıyla yapılıyor (`src/lib/passed-stops.ts` → `trimRoutePathFrom`), yön hesabı da aynı pencereyi kullanıyor; haritaya "Hafif Mod / 3D Bina Açık" anahtarı eklendi (yüksek modda etiketler + `fill-extrusion` 3D binalar, seçim `localStorage`'da saklanıyor); sekme arka plana alındığında veya harita ekran dışına çıktığında (visibilitychange + IntersectionObserver) render ve kamera döngüsü duruyor, geri dönünce kendini toparlıyor.

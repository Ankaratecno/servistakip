// Konuma göre otomatik durak anonsları.
// Şoförün radyo panelinde düğmeye basmasına gerek kalmadan, servis durağa
// yaklaşınca hazır anons kaydı yayına girer (hem şoförde hem yolcularda duyulur).
//
// Kurallar:
//  - 25 SAAT FIRIN  → ~2 dakika kala ve ~30 saniye kala (30 sn anonsu + espri)
//  - ELOKTROLAND    → ~30 saniye kala
// Her anons gün içinde durak başına yalnızca bir kez çalar; servis duraktan
// uzaklaşırsa (yeni tur) kilit kendiliğinden sıfırlanır.

import { stopAnnouncement, type StopAnnouncementKey } from "@/lib/voice-assets";
import { queueRadioAnnouncement } from "@/lib/radio-announce";

/** Durak adı → tetikleyiciler (eşik saniye + anons paketi). */
interface Trigger {
  /** Bu ETA'nın altına inilince çalar (saniye). */
  etaS: number;
  /** ETA yoksa yedek mesafe eşiği (metre). */
  distanceM: number;
  key: StopAnnouncementKey;
  /** Aynı durakta birden fazla tetikleyiciyi ayırmak için benzersiz ad. */
  slot: string;
}

const TRIGGERS: Record<string, Trigger[]> = {
  "25 SAAT FIRIN": [
    { etaS: 120, distanceM: 900, key: "bakery2min", slot: "2dk" },
    { etaS: 30, distanceM: 220, key: "bakeryNear", slot: "30sn" },
  ],
  ELOKTROLAND: [{ etaS: 30, distanceM: 220, key: "factory", slot: "30sn" }],
};

/** Bu mesafenin ötesine çıkılırsa tetikleyici kilidi sıfırlanır. */
const RESET_M = 2000;

export interface AutoAnnounceState {
  fired: Set<string>;
}

export const initialAutoAnnounceState = (): AutoAnnounceState => ({ fired: new Set() });

function norm(name: string): string {
  return name.trim().toLocaleUpperCase("tr-TR");
}

export function hasAutoAnnouncement(stopName: string): boolean {
  return TRIGGERS[norm(stopName)] != null;
}

export interface AutoAnnounceInput {
  stopId: string;
  stopName: string;
  distanceM: number;
  etaS: number | null;
  /** Servis durağa yaklaşıyor mu; false ise anons yapılmaz. */
  approaching: boolean;
}

/**
 * Sıradaki durak için otomatik anons gerekiyorsa kuyruğa bırakır.
 * Çalınan anonsun etiketini döndürür (yoksa null).
 */
export function ingestAutoAnnounce(
  state: AutoAnnounceState,
  input: AutoAnnounceInput,
): string | null {
  const triggers = TRIGGERS[norm(input.stopName)];
  if (!triggers) return null;

  // Uzaklaşınca kilitleri sıfırla (bir sonraki tur yeniden çalsın).
  if (input.distanceM > RESET_M) {
    triggers.forEach((t) => state.fired.delete(`${input.stopId}:${t.slot}`));
    return null;
  }
  if (!input.approaching) return null;

  // En yakın (en küçük eşikli) tetikleyiciden başla ki 30 sn anonsu kaçmasın.
  const sorted = [...triggers].sort((a, b) => a.etaS - b.etaS);
  for (const t of sorted) {
    const id = `${input.stopId}:${t.slot}`;
    if (state.fired.has(id)) continue;
    const reached =
      input.etaS != null && isFinite(input.etaS)
        ? input.etaS <= t.etaS || input.distanceM <= t.distanceM
        : input.distanceM <= t.distanceM;
    if (!reached) continue;
    state.fired.add(id);
    // Daha geniş eşikli (erken) anonslar artık geçersiz — tekrar çalmasınlar.
    sorted.forEach((o) => {
      if (o.etaS > t.etaS) state.fired.add(`${input.stopId}:${o.slot}`);
    });
    const a = stopAnnouncement(t.key, true);
    queueRadioAnnouncement(a);
    return a.label;
  }
  return null;
}

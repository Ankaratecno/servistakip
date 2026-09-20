// Otomatik durak anonsu (TTS + GPS yakınlık).
// Şoför cihazında üretilir ve yolculara canlı gönderilir.

/** Yedek (sabit) anons eşiği — dinamik eşik hesaplanamazsa kullanılır. */
export const ANNOUNCE_M = 350;
/**
 * #36: Anons kilidi artık mesafeyle DEĞİL, "durak geçildi" olayıyla sıfırlanır.
 * Yakın duraklarda (700 m'den az aralıklı) uyarı atlanması böylece biter.
 */

export interface StopAnnouncePayload {
  type: "announce";
  stopId: string;
  stopName: string;
  distanceM: number;
  /** Tahmini varış süresi (saniye) — ETA tabanlı anons metni için (#33) */
  etaS?: number;
  ts: number;
}

export interface AnnounceState {
  /** Anonsu yapılmış durak id'leri */
  announced: Set<string>;
}

export const initialAnnounceState = (): AnnounceState => ({ announced: new Set<string>() });

/**
 * Durak mesafesini işler; anons yapılması gerekiyorsa true döner.
 * Eşik hıza göre dinamik verilir (#35). Kilit yalnızca `resetAnnounce` ile
 * (durak geçildiğinde) açılır (#36).
 */
export function ingestStopDistance(
  state: AnnounceState,
  stopId: string,
  distanceM: number,
  thresholdM: number = ANNOUNCE_M,
): boolean {
  if (distanceM <= thresholdM && !state.announced.has(stopId)) {
    state.announced.add(stopId);
    return true;
  }
  return false;
}

/** Durak geçildiğinde anons kilidini açar (yeni tur / tekrar geçiş için). */
export function resetAnnounce(state: AnnounceState, stopId: string) {
  state.announced.delete(stopId);
}

export function announceText(stopName: string, etaS?: number | null): string {
  const base = `Sayın yolcular, yaklaşan durağımız ${stopName}`;
  if (etaS == null || !isFinite(etaS)) {
    return `${base}. İnecek yolcularımız hazırlansın.`;
  }
  if (etaS <= 45) return `${base}. Durağa geliyoruz, inecek yolcularımız hazırlansın.`;
  const mins = Math.max(1, Math.round(etaS / 60));
  return `${base}. Tahmini ${mins} dakika. İnecek yolcularımız hazırlansın.`;
}

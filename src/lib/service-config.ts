// Servis aracı bilgileri - koda gömülü (yalnızca bu plakalı şoför "başlat" diyebilir)
export const SERVICE_INFO = {
  plate: "06 FNJ 165",
  driverName: "TANER BAYSAL",
  vehicle: "Volkswagen Crafter",
  year: 2016,
  operator: "Acrob Elektroland",
  route: "İnsafsız Kara Aracı Servis Güzergâhı",
} as const;

// PeerJS'te sabit peer ID - yolcular buraya bağlanır
// Plakadan türetiyoruz ki başka servisle çakışmasın
export const DRIVER_PEER_ID = "acrob-elektroland-06fnj165-driver";

// OSRM public demo (ücretsiz, anahtar yok - yoğun trafik için sonra self-host)
export const OSRM_BASE = "https://router.project-osrm.org";

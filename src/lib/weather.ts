// 13. madde – Open-Meteo hava durumu (ücretsiz, API anahtarı gerekmez)
// https://open-meteo.com/ – ticari olmayan kullanım için tamamen ücretsiz, kayıt yok.

export interface WeatherNow {
  tempC: number;
  feelsC: number;
  windKmh: number;
  gustKmh: number;
  humidity: number;
  precipMm: number;
  code: number;
  isDay: boolean;
  ts: number;
  lat: number;
  lng: number;
}

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

export async function fetchWeather(lat: number, lng: number): Promise<WeatherNow | null> {
  const url =
    `${ENDPOINT}?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day" +
    "&wind_speed_unit=kmh&timezone=auto";
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current?: Record<string, number>;
    };
    const c = json.current;
    if (!c) return null;
    return {
      tempC: Number(c["temperature_2m"] ?? 0),
      feelsC: Number(c["apparent_temperature"] ?? 0),
      windKmh: Number(c["wind_speed_10m"] ?? 0),
      gustKmh: Number(c["wind_gusts_10m"] ?? 0),
      humidity: Number(c["relative_humidity_2m"] ?? 0),
      precipMm: Number(c["precipitation"] ?? 0),
      code: Number(c["weather_code"] ?? 0),
      isDay: Number(c["is_day"] ?? 1) === 1,
      ts: Date.now(),
      lat,
      lng,
    };
  } catch {
    return null;
  }
}

// WMO hava kodu → Türkçe açıklama + ikon
export function describeCode(code: number, isDay = true): { label: string; icon: string } {
  const sun = isDay ? "☀️" : "🌙";
  if (code === 0) return { label: "Açık", icon: sun };
  if (code === 1) return { label: "Az bulutlu", icon: isDay ? "🌤️" : "🌙" };
  if (code === 2) return { label: "Parçalı bulutlu", icon: "⛅" };
  if (code === 3) return { label: "Kapalı", icon: "☁️" };
  if (code === 45 || code === 48) return { label: "Sisli", icon: "🌫️" };
  if (code >= 51 && code <= 57) return { label: "Çisenti", icon: "🌦️" };
  if (code >= 61 && code <= 65) return { label: "Yağmurlu", icon: "🌧️" };
  if (code === 66 || code === 67) return { label: "Dondurucu yağmur", icon: "🧊" };
  if (code >= 71 && code <= 77) return { label: "Kar yağışlı", icon: "🌨️" };
  if (code >= 80 && code <= 82) return { label: "Sağanak", icon: "🌧️" };
  if (code === 85 || code === 86) return { label: "Kar sağanağı", icon: "❄️" };
  if (code === 95) return { label: "Gök gürültülü", icon: "⛈️" };
  if (code === 96 || code === 99) return { label: "Dolulu fırtına", icon: "⛈️" };
  return { label: "—", icon: "🌡️" };
}

// Sürüş açısından uyarı metni (yol durumu)
export function driveHint(w: WeatherNow): string | null {
  if (w.code >= 71 && w.code <= 86) return "❄️ Kar/buzlanma riski – hız düşür, mesafeyi artır.";
  if (w.code === 66 || w.code === 67) return "🧊 Dondurucu yağmur – yol çok kaygan.";
  if (w.code >= 95) return "⛈️ Gök gürültülü fırtına – görüş ve yol tutuşu düşük.";
  if (w.code === 45 || w.code === 48) return "🌫️ Sis – sis farı ve düşük hız.";
  if (w.precipMm > 0.2) return "🌧️ Islak zemin – fren mesafesi uzar.";
  if (w.gustKmh >= 50) return "💨 Kuvvetli rüzgâr – yan rüzgâra dikkat.";
  if (w.tempC <= 3) return "🧊 Sıfıra yakın sıcaklık – buzlanma olabilir.";
  return null;
}

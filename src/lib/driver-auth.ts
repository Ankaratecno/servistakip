// Şoför girişi - koda gömülü (GitHub deposundaki bu dosyadan okunur, sunucu yok)
// Şifreyi değiştirmek için sadece bu satırı düzenleyin.
export const DRIVER_PASSWORD = "ankara06";

export const DRIVER_SESSION_KEY = "driver-unlocked";

export function checkDriverPassword(input: string): boolean {
  return input.trim() === DRIVER_PASSWORD;
}

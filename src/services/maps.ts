import type { Venue } from "./api";

/**
 * Открыть точку кофейни в картах. Кросс-платформенно:
 * - на мобильных `geo:` URI даёт системный выбор приложения (Яндекс/2ГИС/Google/…);
 * - как универсальный фолбэк — веб-Яндекс.Карты (открывается и в приложении, и в браузере).
 */
export function openInMaps(venue: Venue): void {
  const { latitude: lat, longitude: lon, address, name } = venue;
  const label = [name, address].filter(Boolean).join(", ");

  // Веб-ссылка Яндекс.Карт — надёжный фолбэк для любой платформы.
  const webUrl =
    lat != null && lon != null
      ? `https://yandex.ru/maps/?pt=${lon},${lat}&z=17&l=map&text=${encodeURIComponent(
          label || `${lat},${lon}`,
        )}`
      : `https://yandex.ru/maps/?text=${encodeURIComponent(label)}`;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile && lat != null && lon != null) {
    // geo: с координатами и подписью — ОС предложит установленные карты.
    const geo = `geo:${lat},${lon}?q=${encodeURIComponent(label || `${lat},${lon}`)}`;
    // Если geo-хендлера нет, через 600мс открываем веб-фолбэк.
    const fallback = window.setTimeout(() => {
      window.location.href = webUrl;
    }, 600);
    window.addEventListener(
      "pagehide",
      () => window.clearTimeout(fallback),
      { once: true },
    );
    window.location.href = geo;
    return;
  }

  window.open(webUrl, "_blank", "noopener");
}

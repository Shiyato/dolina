import QRCode from "qrcode";

/**
 * QR-код карты лояльности. В QR зашивается трек карты (номер), который кассир
 * сканирует в iikoFront — iiko начисляет/списывает бонусы по этой карте.
 */

/** PNG-буфер QR по содержимому (обычно cardTrack). */
export function qrPng(content: string, size = 512): Promise<Buffer> {
  return QRCode.toBuffer(content, {
    type: "png",
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** SVG-строка QR по содержимому. */
export function qrSvg(content: string): Promise<string> {
  return QRCode.toString(content, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}

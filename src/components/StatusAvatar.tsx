import Avatar from "./Avatar";
import type { LoyaltyStatus } from "../services/loyalty";

/**
 * Аватар с обводкой в цвет статуса лояльности:
 * серебряная — СТАНДАРТ, бронзовая — ПРЕТЕНДЕНТ, золотая — ВИП.
 *
 * Обводка — градиентная подложка с внутренним отступом (padding), а не `ring`:
 * `<img>` с object-cover перекрывает ring-inset, и обводка была бы не видна.
 */
export default function StatusAvatar({
  src,
  name,
  status,
  size,
  ringWidth = 3,
  className = "",
}: {
  src: string | null;
  name?: string;
  status: LoyaltyStatus;
  /** Диаметр аватара (без обводки), px. */
  size: number;
  /** Толщина обводки, px. */
  ringWidth?: number;
  className?: string;
}) {
  const gradient =
    status === "pro"
      ? "var(--gradient-pro)"
      : status === "contender"
        ? "var(--gradient-contender)"
        : "var(--gradient-silver)";
  return (
    <span
      className={`inline-flex rounded-full ${className}`}
      style={{
        padding: ringWidth,
        // Именно backgroundImage: градиент — не background-color.
        backgroundImage: gradient,
      }}
    >
      <Avatar
        src={src}
        name={name}
        className="block"
        style={{ width: size, height: size }}
      />
    </span>
  );
}

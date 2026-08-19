import { useState, type CSSProperties } from "react";
import placeholder from "../assets/avatar-placeholder.svg";

/**
 * Аватар гостя. Показывает фото из VK (photo_200); при отсутствии или ошибке
 * загрузки — локальную заглушку. Круглый, обрезает изображение по кругу.
 */
export default function Avatar({
  src,
  name,
  className = "",
  style,
}: {
  src: string | null;
  name?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const url = !src || failed ? placeholder : src;

  return (
    <img
      src={url}
      alt={name ? `Аватар ${name}` : "Аватар"}
      onError={() => setFailed(true)}
      style={style}
      className={`rounded-full bg-[var(--color-avatar)] object-cover ${className}`}
    />
  );
}

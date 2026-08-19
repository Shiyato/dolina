import { useEffect, useRef, useState } from "react";
import logoWordmark from "../assets/logo-wordmark.svg";
import { useAuth } from "../auth/AuthContext";
import { renderOneTap } from "../services/vk";
import { fetchVenue, type Venue } from "../services/api";
import { openInMaps } from "../services/maps";

/**
 * Экран авторизации через VK ID.
 * Состояния: обычное · вход (pending) · «не зарегистрирован» · ошибка.
 * При VK_ENABLED рендерится официальный виджет VK ID OneTap; иначе — dev-мок.
 */
export default function AuthScreen() {
  const { unregisteredPhone } = useAuth();
  if (unregisteredPhone) return <NotRegistered />;
  return <SignIn />;
}

function SignIn() {
  const {
    vkEnabled,
    pending,
    error,
    loginWithProfile,
    mockLogin,
    reportError,
    cancelPending,
  } = useAuth();

  return (
    <div className="flex h-full flex-col items-center justify-between bg-white px-[30px] pt-[80px] pb-[40px]">
      <div className="flex flex-1 flex-col items-center justify-center">
        <img src={logoWordmark} alt="Долина кофе" className="h-[64px] w-[183px]" />
        <p className="mt-[20px] text-center font-montserrat text-[15px] leading-[20px] text-[var(--color-muted)]">
          Программа лояльности
          <br />
          кофейни Долина Кофе
        </p>
      </div>

      <div className="w-full">
        {vkEnabled ? (
          <VkOneTap
            onSuccess={loginWithProfile}
            onError={reportError}
            onCancel={cancelPending}
            pending={pending}
          />
        ) : (
          <MockButtons pending={pending} onLogin={mockLogin} />
        )}

        {error && (
          <p className="mt-[12px] text-center font-sans text-[14px] text-[#FF3B30]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Официальный виджет VK ID OneTap. */
function VkOneTap({
  onSuccess,
  onError,
  onCancel,
  pending,
}: {
  onSuccess: Parameters<typeof renderOneTap>[1]["onSuccess"];
  onError: (m: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: (() => void) | undefined;
    try {
      cleanup = renderOneTap(el, { onSuccess, onError, onCancel });
    } catch {
      setFailed(true);
      onError("Не удалось загрузить VK ID. Обновите страницу.");
    }
    return () => cleanup?.();
  }, [onSuccess, onError, onCancel]);

  return (
    <div className="relative min-h-[56px] w-full">
      {/* Контейнер, куда VK ID рендерит кнопку входа. Тень (.tap) даёт сигнал
          кликабельности — сам виджет VK её не рисует. Радиус совпадает с кнопкой. */}
      <div
        ref={ref}
        className={failed ? "hidden" : "tap overflow-hidden rounded-[28px]"}
      />
      {pending && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <Spinner />
        </div>
      )}
    </div>
  );
}

/** DEV-кнопки: обычный вход и проверка ветки «не зарегистрирован». */
function MockButtons({
  pending,
  onLogin,
}: {
  pending: boolean;
  onLogin: (variant?: "registered" | "unregistered") => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onLogin("registered")}
      disabled={pending}
      className="tap flex h-[56px] w-full items-center justify-center gap-[10px] rounded-full bg-[var(--color-ios-blue)] font-sans text-[17px] font-semibold tracking-[-0.4px] text-white disabled:opacity-60"
    >
      {pending ? (
        <Spinner />
      ) : (
        <>
          <VkGlyph />
          Войти через VK ID
        </>
      )}
    </button>
  );
}

function NotRegistered() {
  const { logout, recheckRegistration } = useAuth();
  const [venue, setVenue] = useState<Venue | null>(null);

  useEffect(() => {
    let alive = true;
    fetchVenue().then((v) => alive && setVenue(v));
    return () => {
      alive = false;
    };
  }, []);

  // Авто-проверка: если гостя завели на кассе, пока он на этом экране —
  // при успехе AuthContext сам переключит на главный. Проверяем каждые 5с
  // и при возврате вкладки на передний план.
  useEffect(() => {
    let stopped = false;
    const check = () => {
      if (!stopped && document.visibilityState === "visible") {
        void recheckRegistration();
      }
    };
    const timer = window.setInterval(check, 5000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [recheckRegistration]);

  return (
    <div className="flex h-full flex-col items-center justify-between bg-white px-[30px] pt-[80px] pb-[40px]">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex size-[72px] items-center justify-center rounded-full bg-[var(--color-secondary-bg)]">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="var(--color-muted)" strokeWidth="2" />
            <path d="M12 7v6" stroke="var(--color-muted)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="1.2" fill="var(--color-muted)" />
          </svg>
        </div>
        <h1 className="mt-[20px] font-montserrat text-[22px] font-black leading-[28px] tracking-[-0.4px] text-black">
          Вы не зарегистрированы
          <br />в системе лояльности
        </h1>
        <p className="mt-[12px] font-montserrat text-[15px] leading-[21px] text-[var(--color-muted)]">
          Чтобы продолжить, прийдите
          <br />в кофейню Долина Кофе
        </p>
        {venue?.address && (
          <p className="mt-[12px] font-sans text-[14px] leading-[19px] text-black">
            {venue.address}
          </p>
        )}
        <p className="mt-[16px] font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
          Как только вас зарегистрируют на кассе,
          <br />
          карта откроется автоматически
        </p>
      </div>

      <div className="w-full">
        {venue && (venue.latitude != null || venue.address) && (
          <button
            type="button"
            onClick={() => openInMaps(venue)}
            className="tap flex h-[56px] w-full items-center justify-center gap-[8px] rounded-full bg-black font-sans text-[17px] font-semibold tracking-[-0.4px] text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="2" />
            </svg>
            Найти на карте
          </button>
        )}
        <button
          type="button"
          onClick={logout}
          className="tap mt-[12px] h-[56px] w-full rounded-full bg-white font-sans text-[17px] font-semibold tracking-[-0.4px] text-black"
        >
          Назад
        </button>
      </div>
    </div>
  );
}

function VkGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12.9 17c-5 0-8.2-3.5-8.3-9.3h2.6c.1 4.3 2 6.1 3.5 6.5V7.7h2.4v3.7c1.5-.2 3-1.8 3.6-3.7h2.4c-.4 2.3-2 3.9-3.1 4.6 1.1.5 2.9 1.9 3.6 4.7h-2.6c-.5-1.9-1.9-3.3-3.5-3.5V17h-.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="size-[22px] animate-spin text-[var(--color-ios-blue)]" viewBox="0 0 24 24" fill="none" aria-label="Загрузка">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

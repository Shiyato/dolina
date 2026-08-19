/**
 * Сейм к VK ID. Задача — получить номер телефона гостя (scope `phone`) плюс
 * имя и аватар из профиля VK. Телефон — ключ поиска карты в iiko.
 *
 * Конфигурация приложения (из vk_auth.html — сгенерирована VK для этого app):
 *   app: 54684617, redirectUrl: https://dolina-coffee.ru,
 *   responseMode: Callback, source: LOWCODE, scope: "phone".
 *
 * Поток (клиентский, PKCE — секрет в браузере не нужен):
 *   1) VKID OneTap → LOGIN_SUCCESS → { code, device_id }
 *   2) VKID.Auth.exchangeCode(code, device_id) → access_token (PKCE)
 *   3) VKID.Auth.userInfo(access_token) → { phone, first_name, avatar }
 *   4) телефон уходит в iiko (customer/info)
 *
 * SDK подключён как ESM-пакет @vkid/sdk (не рантайм-UMD — тот битый бандл ронял
 * render с "t is not a function"). В DEV реальный VK не работает (домен localhost
 * не авторизован в приложении), поэтому по умолчанию мок. Override — VITE_VK_MODE.
 */
import * as VKID from "@vkid/sdk";

export const VK_APP_ID = 54684617;
export const VK_REDIRECT_URL = "https://dolina-coffee.ru";
export const VK_SCOPE = "phone";

/** Профиль, который отдаёт VK после успешного входа. */
export interface VkProfile {
  /** Телефон в формате +7XXXXXXXXXX. */
  phone: string;
  /** Имя из VK (может быть переопределено данными iiko). */
  name: string | null;
  /** Аватар из VK. iiko аватар не отдаёт — VK единственный источник. */
  avatarUrl: string | null;
}

/** Включён ли реальный VK. По умолчанию: прод — да, dev — нет. */
export const VK_ENABLED: boolean =
  (import.meta.env.VITE_VK_MODE ?? (import.meta.env.PROD ? "real" : "mock")) ===
  "real";

// Однократная инициализация Config.
let configured = false;
function ensureConfig(): void {
  if (configured) return;
  VKID.Config.init({
    app: VK_APP_ID,
    redirectUrl: VK_REDIRECT_URL,
    responseMode: VKID.ConfigResponseMode.Callback,
    source: VKID.ConfigSource.LOWCODE,
    scope: VK_SCOPE,
  });
  configured = true;
}

/** Нормализация телефона VK → +7XXXXXXXXXX. */
function normalizePhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (digits.length === 10) return "+7" + digits;
  return digits ? "+" + digits : "";
}

/** Профиль (телефон/имя/аватар) из userInfo по access_token. */
async function fetchProfile(accessToken: string): Promise<VkProfile> {
  const { user } = await VKID.Auth.userInfo(accessToken);
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || null;
  return {
    phone: normalizePhone(user.phone),
    name,
    avatarUrl: user.avatar ?? null,
  };
}

/**
 * Рендерит виджет VK ID OneTap в контейнер. Возвращает функцию очистки.
 * LOGIN_SUCCESS → exchangeCode → userInfo → профиль.
 */
export function renderOneTap(
  container: HTMLElement,
  handlers: {
    onSuccess: (profile: VkProfile) => void;
    onError: (message: string) => void;
    /** Пользователь закрыл окно VK, не завершив вход (не ошибка). */
    onCancel: () => void;
  },
): () => void {
  ensureConfig();
  const oneTap = new VKID.OneTap();

  oneTap
    .render({
      container,
      // Отключаем «быстрый вход» (Продолжить как …): его фоновая проверка сессии
      // VK тормозит загрузку и периодически отваливается по таймауту. Как в
      // исходном vk_auth.html. Кнопка рендерится сразу как обычная.
      fastAuthEnabled: false,
      showAlternativeLogin: true,
      styles: { borderRadius: 28, height: 56 },
    })
    .on(VKID.WidgetEvents.ERROR, (error: unknown) => {
      const code = (error as { code?: number } | null)?.code;
      const text = String((error as { text?: string } | null)?.text ?? "");
      // Закрытие окна (code 2 "closed") — отмена пользователя, молча.
      if (code === 2 || /closed/i.test(text)) {
        handlers.onCancel();
        return;
      }
      // eslint-disable-next-line no-console
      console.error("[VK ID] WidgetEvents.ERROR:", error);
      // Таймаут (code 0) — VK долго отвечает; сообщаем мягко, кнопка остаётся.
      if (code === 0 || /timeout/i.test(text)) {
        handlers.onError("VK долго отвечает. Проверьте соединение и попробуйте ещё раз.");
        return;
      }
      handlers.onError("Ошибка VK ID. Попробуйте ещё раз.");
    })
    .on(
      VKID.OneTapInternalEvents.LOGIN_SUCCESS,
      async (payload: { code: string; device_id: string }) => {
        try {
          const { access_token } = await VKID.Auth.exchangeCode(
            payload.code,
            payload.device_id,
          );
          const profile = await fetchProfile(access_token);
          if (!profile.phone) {
            handlers.onError(
              "VK не передал номер телефона. Разрешите доступ к телефону.",
            );
            return;
          }
          handlers.onSuccess(profile);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[VK ID] exchange/userInfo failed:", e);
          handlers.onError("Не удалось завершить вход через VK.");
        }
      },
    );

  return () => {
    try {
      oneTap.close();
    } catch {
      /* noop */
    }
    container.replaceChildren();
  };
}

// ── DEV-мок ────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MOCK_REGISTERED_PHONE = "+79991234567";
const MOCK_UNREGISTERED_PHONE = "+79990000000";

/** Мок входа для локальной разработки (две ветки: гость есть / нет). */
export async function mockLogin(
  variant: "registered" | "unregistered" = "registered",
): Promise<VkProfile> {
  await delay(800);
  return {
    phone: variant === "registered" ? MOCK_REGISTERED_PHONE : MOCK_UNREGISTERED_PHONE,
    name: null,
    avatarUrl: null,
  };
}

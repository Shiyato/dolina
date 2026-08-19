import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Customer } from "../services/types";
import * as vk from "../services/vk";
import type { VkProfile } from "../services/vk";
import * as iiko from "../services/iiko";

const SESSION_KEY = "dolina.session";

interface Session {
  /** Телефон — ключ повторной загрузки гостя из iiko (бэкенд ищет по нему). */
  phone: string;
  /** Аватар из VK — iiko его не отдаёт, поэтому храним в сессии. */
  avatarUrl: string | null;
}

interface AuthState {
  status: "loading" | "authorized" | "unauthorized";
  customer: Customer | null;
  /** Телефон при неуспешной регистрации — для экрана «не зарегистрирован». */
  unregisteredPhone: string | null;
  /** Выполняется вход (обмен кода / запрос iiko). */
  pending: boolean;
  error: string | null;
  /** Включён ли реальный VK ID (иначе — dev-мок). */
  vkEnabled: boolean;
  /** Завершить вход по профилю из VK (телефон → iiko). */
  loginWithProfile: (profile: VkProfile) => Promise<void>;
  /** DEV-мок входа (две ветки). */
  mockLogin: (variant?: "registered" | "unregistered") => Promise<void>;
  /** Сообщить об ошибке VK-виджета. */
  reportError: (message: string) => void;
  /** Пользователь отменил вход (закрыл окно VK). */
  cancelPending: () => void;
  /** Перепроверить регистрацию (гостя могли завести на кассе). true = найден. */
  recheckRegistration: () => Promise<boolean>;
  /**
   * Погасить флаг «показать модал о статусе претендента» после показа.
   * Без этого модал всплывал бы заново при каждом возврате на карту:
   * CardScreen перемонтируется и снова читает notifyContender из гостя.
   */
  clearContenderNotice: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [unregisteredPhone, setUnregisteredPhone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Профиль VK последнего входа — для повторной проверки регистрации (polling).
  const lastProfile = useRef<VkProfile | null>(null);

  /** Записать гостя в сессию и авторизовать. */
  const authorize = useCallback((found: Customer, profile: VkProfile) => {
    // Аватар из VK приоритетнее — iiko аватар не отдаёт.
    const merged: Customer = {
      ...found,
      avatarUrl: profile.avatarUrl ?? found.avatarUrl,
    };
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        phone: profile.phone,
        avatarUrl: merged.avatarUrl,
      } satisfies Session),
    );
    setUnregisteredPhone(null);
    setCustomer(merged);
    setStatus("authorized");
  }, []);

  const clearContenderNotice = useCallback(() => {
    setCustomer((c) => (c && c.notifyContender ? { ...c, notifyContender: false } : c));
  }, []);

  /** Телефон + профиль VK → поиск в iiko → сессия либо «не зарегистрирован». */
  const loginWithProfile = useCallback(
    async (profile: VkProfile) => {
      setPending(true);
      setError(null);
      setUnregisteredPhone(null);
      lastProfile.current = profile;
      try {
        const found = await iiko.getCustomerByPhone(profile.phone);
        if (found) {
          authorize(found, profile);
        } else {
          // Гость не найден в лояльности — регистрация только офлайн, на кассе.
          setUnregisteredPhone(profile.phone);
        }
      } catch {
        // ВАЖНО: ошибка запроса — это НЕ «не зарегистрирован». Показываем ошибку,
        // экран «не зарегистрированы» тут появиться не должен.
        setError("Не удалось выполнить вход. Попробуйте ещё раз.");
      } finally {
        setPending(false);
      }
    },
    [authorize],
  );

  /**
   * Повторная проверка регистрации (для экрана «не зарегистрированы»).
   * Если гостя уже завели на кассе — авторизуем и уводим на главный.
   * Возвращает true, если гость найден. Сетевые ошибки игнорирует (не роняет
   * пользователя с экрана).
   */
  const recheckRegistration = useCallback(async (): Promise<boolean> => {
    const profile = lastProfile.current;
    if (!profile) return false;
    try {
      const found = await iiko.getCustomerByPhone(profile.phone);
      if (found) {
        authorize(found, profile);
        return true;
      }
    } catch {
      /* временная ошибка сети — просто ждём следующей проверки */
    }
    return false;
  }, [authorize]);

  const mockLogin = useCallback(
    async (variant: "registered" | "unregistered" = "registered") => {
      const profile = await vk.mockLogin(variant);
      await loginWithProfile(profile);
    },
    [loginWithProfile],
  );

  const reportError = useCallback((message: string) => {
    setPending(false);
    setError(message);
  }, []);

  /** Пользователь отменил вход (закрыл окно VK) — просто сбрасываем состояние. */
  const cancelPending = useCallback(() => {
    setPending(false);
    setError(null);
  }, []);

  // Восстановление сессии при загрузке.
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      // DEV: быстрый вход для демо/скриншотов — открыть с #demo / #profile.
      const h = window.location.hash;
      if (import.meta.env.DEV && (h.startsWith("#demo") || h.startsWith("#profile"))) {
        void mockLogin("registered");
      }
      setStatus("unauthorized");
      return;
    }
    try {
      const session = JSON.parse(raw) as Session;
      iiko
        .getCustomerByPhone(session.phone)
        .then((c) => {
          if (c) {
            setCustomer({ ...c, avatarUrl: session.avatarUrl ?? c.avatarUrl });
            setStatus("authorized");
          } else {
            localStorage.removeItem(SESSION_KEY);
            setStatus("unauthorized");
          }
        })
        .catch(() => setStatus("unauthorized"));
    } catch {
      localStorage.removeItem(SESSION_KEY);
      setStatus("unauthorized");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setCustomer(null);
    setUnregisteredPhone(null);
    setError(null);
    setStatus("unauthorized");
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      customer,
      unregisteredPhone,
      pending,
      error,
      vkEnabled: vk.VK_ENABLED,
      loginWithProfile,
      mockLogin,
      reportError,
      cancelPending,
      recheckRegistration,
      clearContenderNotice,
      logout,
    }),
    [status, customer, unregisteredPhone, pending, error, loginWithProfile, mockLogin, reportError, cancelPending, recheckRegistration, clearContenderNotice, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

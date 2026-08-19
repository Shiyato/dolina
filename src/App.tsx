import { useState } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import AuthScreen from "./screens/AuthScreen";
import CardScreen from "./screens/CardScreen";
import ProfileScreen from "./screens/ProfileScreen";
import type { Customer } from "./services/types";
import {
  MOCK_CUSTOMER_CONTENDER_NEW,
  MOCK_CUSTOMER_PRO,
  MOCK_CUSTOMER_STANDARD,
} from "./services/mockData";

type View = "card" | "profile";

/**
 * DEV-превью состояний по хэшу. Подменяем гостя ЗДЕСЬ, а не внутри экрана:
 * иначе карта и профиль показывали разных гостей — например, из #profile-pro
 * возврат на карту давал модал претендента, хотя в профиле был ВИП.
 */
function devPreview(customer: Customer): Customer {
  if (!import.meta.env.DEV) return customer;
  const h = window.location.hash;
  if (h.includes("standard")) return MOCK_CUSTOMER_STANDARD;
  if (h.includes("pro") || h.includes("vip")) return MOCK_CUSTOMER_PRO;
  if (h.includes("contender")) return MOCK_CUSTOMER_CONTENDER_NEW;
  return customer;
}

/** Приватная зона: карта ↔ профиль. */
function Authorized() {
  const { customer, logout, clearContenderNotice } = useAuth();
  const [view, setView] = useState<View>(
    // DEV: #profile открывает профиль сразу (для демо/скриншотов).
    import.meta.env.DEV && window.location.hash.startsWith("#profile") ? "profile" : "card",
  );
  const [noticeShown, setNoticeShown] = useState(false);
  if (!customer) return null;
  // Флаг «уведомление показано» держим и здесь: он должен пережить
  // перемонтирование CardScreen (уход в профиль и обратно) и не зависеть от
  // того, подменён ли гость dev-превью.
  const base = devPreview(customer);
  const shown =
    noticeShown && base.notifyContender ? { ...base, notifyContender: false } : base;

  return view === "card" ? (
    <CardScreen
      customer={shown}
      onOpenProfile={() => setView("profile")}
      onContenderNoticeShown={() => {
        setNoticeShown(true);
        clearContenderNotice();
      }}
    />
  ) : (
    <ProfileScreen
      customer={shown}
      onBack={() => setView("card")}
      onLogout={logout}
    />
  );
}

function Router() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <svg className="size-[28px] animate-spin text-[var(--color-muted)]" viewBox="0 0 24 24" fill="none" aria-label="Загрузка">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return status === "authorized" ? <Authorized /> : <AuthScreen />;
}

export default function App() {
  return (
    <div className="flex min-h-full items-center justify-center bg-neutral-200 sm:p-6">
      {/* Экран телефона 390×844 — на мобильных занимает весь вьюпорт */}
      <div className="h-[100dvh] w-full max-w-[390px] overflow-hidden bg-white shadow-2xl sm:h-[844px] sm:rounded-[44px]">
        <AuthProvider>
          <Router />
        </AuthProvider>
      </div>
    </div>
  );
}

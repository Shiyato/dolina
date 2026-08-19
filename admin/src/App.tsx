import { useCallback, useEffect, useState } from "react";
import TopBar, { type Tab } from "./components/TopBar";
import WeekBar from "./components/WeekBar";
import WeekBadge from "./components/WeekBadge";
import LoginScreen from "./screens/LoginScreen";
import TasksScreen from "./screens/TasksScreen";
import AnalyticsScreen from "./screens/AnalyticsScreen";
import {
  fetchWeeks,
  getToken,
  me,
  setToken,
  type AdminUser,
  type WeekInfo,
} from "./services/api";

export default function App() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("tasks");
  const [weeks, setWeeks] = useState<WeekInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [profileOpen, setProfileOpen] = useState(false);

  // Восстановление сессии.
  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    me()
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  const loadWeeks = useCallback(() => {
    fetchWeeks().then((r) => {
      setWeeks(r.weeks);
      setSelected((s) => s || r.current);
    });
  }, []);

  useEffect(() => {
    if (user) loadWeeks();
  }, [user, loadWeeks]);

  const logout = () => {
    setToken(null);
    setUser(null);
    setProfileOpen(false);
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-neutral-200 sm:p-6">
      <div className="h-[100dvh] w-full max-w-[430px] overflow-hidden bg-white shadow-2xl sm:h-[900px] sm:rounded-[44px]">
        {checking ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : !user ? (
          <LoginScreen onLogin={setUser} />
        ) : (
          <div className="relative flex h-full flex-col px-[24px] pt-[20px]">
            <TopBar
              user={user}
              tab={tab}
              onTab={setTab}
              onProfile={() => setProfileOpen(true)}
            />
            <WeekBar weeks={weeks} selected={selected} onSelect={setSelected} />
            <WeekBadge
              week={selected}
              tab={tab}
              isCurrentWeek={
                weeks.find((w) => w.weekStart === selected)?.isCurrent ?? false
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {selected &&
                (tab === "tasks" ? (
                  <TasksScreen week={selected} key={`t-${selected}`} />
                ) : (
                  <AnalyticsScreen
                    week={selected}
                    isCurrentWeek={
                      weeks.find((w) => w.weekStart === selected)?.isCurrent ?? false
                    }
                    key={`a-${selected}`}
                  />
                ))}
            </div>

            {profileOpen && (
              <ProfileSheet user={user} onClose={() => setProfileOpen(false)} onLogout={logout} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Нижний лист профиля: имя, роль, выход. */
function ProfileSheet({
  user,
  onClose,
  onLogout,
}: {
  user: AdminUser;
  onClose: () => void;
  onLogout: () => void;
}) {
  const roleLabel =
    user.role === "owner"
      ? "Владелец"
      : user.role === "admin"
        ? "Администратор"
        : "Менеджер";
  return (
    <div
      className="animate-rise absolute inset-0 z-50 flex items-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-[28px] bg-white px-[28px] pt-[12px] pb-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-[16px] h-[5px] w-[40px] rounded-full bg-black/15" />
        <p className="font-montserrat text-[20px] font-black text-black">
          {`${user.name} ${user.surname}`.trim() || user.login}
        </p>
        <p className="mt-[2px] inline-block rounded-full bg-[var(--color-accent)]/10 px-[10px] py-[3px] font-sans text-[13px] font-semibold text-[var(--color-accent)]">
          {roleLabel}
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="tap mt-[20px] w-full rounded-[16px] bg-[var(--color-secondary-bg)] py-[14px] text-center font-sans text-[16px] text-[var(--color-danger)]"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="size-[28px] animate-spin text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" aria-label="Загрузка">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

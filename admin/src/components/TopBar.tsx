import logoWordmark from "../assets/logo-wordmark.svg";
import avatarPlaceholder from "../assets/avatar-placeholder.svg";
import type { AdminUser } from "../services/api";

export type Tab = "tasks" | "analytics";

/**
 * Верхняя навигация (как в mini-app): аватар · toggle · логотип.
 * Toggle переключает Задания ⇄ Аналитика (иконки: список и график).
 * Акцент админки — синий.
 */
export default function TopBar({
  user,
  tab,
  onTab,
  onProfile,
}: {
  user: AdminUser;
  tab: Tab;
  onTab: (t: Tab) => void;
  onProfile: () => void;
}) {
  return (
    <div className="flex h-[48px] shrink-0 items-center justify-between">
      {/* Аватар → профиль */}
      <button
        type="button"
        onClick={onProfile}
        aria-label={`Профиль: ${user.name} ${user.surname}`}
        className="tap rounded-full"
      >
        <span className="block rounded-full bg-[var(--color-accent)] p-[3px]">
          <img
            src={avatarPlaceholder}
            alt=""
            className="size-[42px] rounded-full bg-[var(--color-avatar)] object-cover"
          />
        </span>
      </button>

      {/* Toggle: Задания / Аналитика */}
      <div className="relative flex h-[48px] w-[133px] items-center rounded-full bg-[var(--color-secondary-bg)] px-[5px] shadow-[inset_0_1px_3px_rgba(0,0,0,0.06)]">
        <span
          className="absolute top-[5px] h-[37px] w-[60px] rounded-full bg-white shadow-sm transition-all duration-200"
          style={{ left: tab === "tasks" ? "5px" : "68px" }}
        />
        <button
          type="button"
          aria-label="Задания"
          aria-pressed={tab === "tasks"}
          onClick={() => onTab("tasks")}
          className="relative z-10 flex h-[37px] w-[60px] items-center justify-center"
        >
          <TasksIcon active={tab === "tasks"} />
        </button>
        <button
          type="button"
          aria-label="Аналитика"
          aria-pressed={tab === "analytics"}
          onClick={() => onTab("analytics")}
          className="relative z-10 flex h-[37px] w-[60px] items-center justify-center"
        >
          <ChartIcon active={tab === "analytics"} />
        </button>
      </div>

      {/* Логотип */}
      <img src={logoWordmark} alt="Долина кофе" className="h-[30px] w-[86px]" />
    </div>
  );
}

/** Иконка «список задач» (чеклист). */
function TasksIcon({ active }: { active: boolean }) {
  const c = active ? "var(--color-accent)" : "var(--color-muted)";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6.5 5.5 8 8.5 5" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 6.5h9" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <path d="M4 12.5 5.5 14 8.5 11" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 12.5h9" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <path d="M4 18.5 5.5 20 8.5 17" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 18.5h9" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Иконка «график» (столбцы). */
function ChartIcon({ active }: { active: boolean }) {
  const c = active ? "var(--color-accent)" : "var(--color-muted)";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="12" width="4" height="8" rx="1" fill={c} />
      <rect x="10" y="7" width="4" height="13" rx="1" fill={c} />
      <rect x="16" y="10" width="4" height="10" rx="1" fill={c} />
    </svg>
  );
}

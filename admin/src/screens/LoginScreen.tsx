import { useState } from "react";
import logoWordmark from "../assets/logo-wordmark.svg";
import { login, type AdminUser } from "../services/api";

/** Экран входа в панель: логин + пароль. */
export default function LoginScreen({
  onLogin,
}: {
  onLogin: (u: AdminUser) => void;
}) {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const u = await login(loginName.trim(), password);
      onLogin(u);
    } catch {
      setError("Неверный логин или пароль");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-between bg-white px-[30px] pt-[80px] pb-[40px]">
      <div className="flex flex-1 flex-col items-center justify-center">
        <img src={logoWordmark} alt="Долина кофе" className="h-[56px] w-[160px]" />
        <p className="mt-[16px] text-center font-montserrat text-[15px] leading-[20px] text-[var(--color-muted)]">
          Панель администратора
        </p>
      </div>

      <form onSubmit={submit} className="w-full">
        <input
          type="text"
          inputMode="text"
          autoComplete="username"
          placeholder="Логин"
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
          className="h-[52px] w-full rounded-[16px] bg-[var(--color-secondary-bg)] px-[18px] font-sans text-[16px] text-black outline-none placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-accent)]"
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-[10px] h-[52px] w-full rounded-[16px] bg-[var(--color-secondary-bg)] px-[18px] font-sans text-[16px] text-black outline-none placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-accent)]"
        />

        {error && (
          <p className="mt-[12px] text-center font-sans text-[14px] text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || !loginName || !password}
          className="tap mt-[16px] h-[56px] w-full rounded-full bg-[var(--color-accent)] font-sans text-[17px] font-semibold tracking-[-0.4px] text-white disabled:opacity-50"
        >
          {pending ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}

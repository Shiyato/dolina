import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";

/**
 * Авторизация админ-панели: логин+пароль (bcrypt) → JWT. Роли admin|manager.
 * Секрет JWT — из окружения (ADMIN_JWT_SECRET); на проде задать обязательно.
 */

const JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? "dev-insecure-secret-change-me";
const TOKEN_TTL = "30d";

/** Роли: owner (владелец) и admin — полный доступ; manager — рабочий доступ. */
export type AdminRole = "owner" | "admin" | "manager";

/** Роли с полным доступом (управление, бэкфилл, пользователи). */
export const PRIVILEGED: AdminRole[] = ["owner", "admin"];

export interface AdminUser {
  id: number;
  login: string;
  name: string;
  surname: string;
  role: AdminRole;
}

interface UserRow extends AdminUser {
  passwordHash: string;
}

/** Первичный сидинг: создать admin из ENV, если пользователей ещё нет. */
export function seedAdmin(): void {
  const count = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
  if (count > 0) return;
  const login = process.env.ADMIN_SEED_LOGIN ?? "admin";
  const password = process.env.ADMIN_SEED_PASSWORD ?? "admin";
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (login, passwordHash, name, surname, role, createdAt) VALUES (?,?,?,?,?,?)",
  ).run(login, hash, "Администратор", "", "admin", new Date().toISOString());
  // eslint-disable-next-line no-console
  console.log(`[admin] seeded first admin: login="${login}"`);
}

/** Проверить логин/пароль, вернуть токен + пользователя либо null. */
export function login(
  loginName: string,
  password: string,
): { token: string; user: AdminUser } | null {
  const row = db
    .prepare("SELECT * FROM users WHERE login = ?")
    .get(loginName) as UserRow | undefined;
  if (!row) return null;
  if (!bcrypt.compareSync(password, row.passwordHash)) return null;
  const user: AdminUser = {
    id: row.id,
    login: row.login,
    name: row.name,
    surname: row.surname,
    role: row.role,
  };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, user };
}

/** Express-мидлвар: требует валидный Bearer-токен, кладёт user в req. */
export function requireAuth(
  req: Request & { adminUser?: AdminUser },
  res: Response,
  next: NextFunction,
): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AdminUser;
    req.adminUser = {
      id: payload.id,
      login: payload.login,
      name: payload.name,
      surname: payload.surname,
      role: payload.role,
    };
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

/** Требует роль admin. */
export function requireAdmin(
  req: Request & { adminUser?: AdminUser },
  res: Response,
  next: NextFunction,
): void {
  if (req.adminUser?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

export { db as adminDb };

import { Router } from "express";
import { config } from "./config.js";
import {
  getCustomerByPhone,
  getCustomerTransactions,
  walletTopup,
  walletChargeoff,
  getVenue,
  createOrder,
  IikoError,
  type IikoTransaction,
} from "./iikoClient.js";
import { addEntry, type JournalEntry } from "./journal.js";
import { qrPng, qrSvg } from "./qr.js";
import { ingestCheck, parseWebhookEvent } from "./admin/ingest.js";
import { backfillManyById, ensureGuestBackfilled } from "./admin/backfill.js";
import { markContenderNotified, resolveLoyalty } from "./loyalty.js";
import { favoriteItemsFor, getOrderMenu } from "./menu.js";

export const router = Router();

const BONUS_WALLET = 1; // тип бонусного кошелька в iiko
const PURCHASE_WINDOW_DAYS = 30; // окно подсчёта покупок для уровня ПРО
const HISTORY_WINDOW_DAYS = 365; // сколько дней истории показываем в профиле

/** iiko-дата "yyyy-MM-dd HH:mm:ss.fff" (UTC) → мс. */
function parseIikoDate(s: string): number {
  return Date.parse(s.replace(" ", "T") + "Z");
}

/** Покупки = закрытые чеки (CloseOrder) за последние `days` дней. */
function countPurchases(txns: IikoTransaction[], days: number): number {
  const since = Date.now() - days * 86_400_000;
  return txns.filter(
    (t) => t.typeName === "CloseOrder" && parseIikoDate(t.whenCreated) >= since,
  ).length;
}

/** Транзакции iiko → операции с баллами (начисления/списания) для профиля. */
function toHistory(txns: IikoTransaction[]) {
  return txns
    .filter(
      (t) =>
        t.walletId != null &&
        t.balanceBefore != null &&
        t.balanceAfter != null &&
        t.balanceAfter !== t.balanceBefore,
    )
    .map((t) => {
      const points = Math.round(((t.balanceAfter ?? 0) - (t.balanceBefore ?? 0)) * 100) / 100;
      return {
        id: t.id,
        date: parseIikoDate(t.whenCreated)
          ? new Date(parseIikoDate(t.whenCreated)).toISOString()
          : t.whenCreated,
        kind: points >= 0 ? ("accrual" as const) : ("redemption" as const),
        points,
        orderSum: t.orderSum,
        place: null as string | null,
        source: "iiko" as const,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Нормализация телефона → +7XXXXXXXXXX (РФ). Терпима к формату от VK. */
function normPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  // 11 цифр с ведущей 8 или 7 → приводим к 10-значному «телу».
  if (d.length === 11 && (d.startsWith("8") || d.startsWith("7"))) {
    d = d.slice(1);
  }
  // 10-значный российский номер → +7XXXXXXXXXX.
  if (d.length === 10) return "+7" + d;
  // Прочее (не РФ / нестандарт) — отдаём с ведущим +, как есть.
  return d ? "+" + d : "";
}

/** Обёртка обработчика: единая обработка ошибок iiko. */
function h(
  fn: (
    req: import("express").Request,
    res: import("express").Response,
  ) => Promise<void>,
) {
  return (
    req: import("express").Request,
    res: import("express").Response,
  ) => {
    fn(req, res).catch((e: unknown) => {
      if (e instanceof IikoError) {
        // eslint-disable-next-line no-console
        console.error("[iiko]", e.status, e.message);
        res.status(502).json({ error: "iiko_error", message: e.message });
      } else {
        // eslint-disable-next-line no-console
        console.error("[api]", e);
        res.status(500).json({ error: "internal" });
      }
    });
  };
}

/** Здоровье сервиса. */
router.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/** Адрес и координаты кофейни (для кнопки «Найти на карте»). */
router.get(
  "/venue",
  h(async (_req, res) => {
    res.json(await getVenue());
  }),
);

/** Меню для дистанционного заказа (панель «огонёк»). */
router.get(
  "/menu",
  h(async (_req, res) => {
    res.json(await getOrderMenu());
  }),
);

/** Любимые позиции гостя (для панели «огонёк»). */
router.get(
  "/customer/:id/favorites",
  h(async (req, res) => {
    res.json(favoriteItemsFor(req.params.id));
  }),
);

/**
 * Оформление дистанционного заказа. Пока онлайн-оплата и внешнее меню iiko не
 * настроены — работаем в режиме заглушки: проверяем корзину, «оплату» считаем
 * успешной, реальный заказ в iiko НЕ создаём (config.orderLive=false). Контракт
 * ответа не изменится, когда подключим провайдера оплаты и создание заказа.
 */
router.post(
  "/order",
  h(async (req, res) => {
    const { items, comment, phone } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "empty_cart" });
      return;
    }
    const total = items.reduce(
      (s: number, i: { price?: number; amount?: number }) =>
        s + (Number(i.price) || 0) * (Number(i.amount) || 1),
      0,
    );
    if (total <= 0) {
      res.status(400).json({ error: "zero_total" });
      return;
    }

    // Боевой режим: создаём реальный заказ в iiko с меткой источника (sourceKey).
    // TODO: перед этим здесь должна пройти онлайн-оплата (External=оплачено).
    if (config.orderLive) {
      const orderItems = items
        .map((i: { id?: string; amount?: number }) => ({
          productId: String(i.id ?? ""),
          amount: Number(i.amount) || 1,
        }))
        .filter((i: { productId: string }) => i.productId);
      const created = await createOrder({
        items: orderItems,
        phone: String(phone ?? "") || "+70000000000",
        comment,
      });
      const ok = created.status !== "Error";
      res.status(ok ? 200 : 502).json({
        ok,
        orderNumber: created.number ?? created.id,
        status: created.status,
        error: created.error,
        paid: true,
        total,
        mode: "live",
      });
      return;
    }

    // Заглушка (пока не настроены оплата/боевой режим): заказ в iiko не создаём.
    const orderNumber = "PWA-" + String(Date.now()).slice(-6);
    // eslint-disable-next-line no-console
    console.log(
      `[order] stub: ${items.length} поз., ${total}₽${comment ? `, «${comment}»` : ""} → ${orderNumber}`,
    );
    res.json({ ok: true, orderNumber, status: "accepted", paid: true, total, mode: "stub" });
  }),
);

/** Данные гостя + баланс бонусов по телефону. */
router.get(
  "/customer",
  h(async (req, res) => {
    const raw = String(req.query.phone ?? "");
    const phone = normPhone(raw);
    if (!phone) {
      res.status(400).json({ error: "phone_required" });
      return;
    }
    const c = await getCustomerByPhone(phone);
    // eslint-disable-next-line no-console
    console.log(
      `[customer] raw="${raw}" norm="${phone}" → ${c ? "FOUND " + c.id : "NOT FOUND"}`,
    );
    if (!c) {
      res.status(404).json({ error: "not_registered" });
      return;
    }
    // У гостя может быть несколько бонусных кошельков (напр. Cashback + VIP).
    // Баланс на счету = сумма всех бонусных; отдаём и разбивку по кошелькам.
    const bonusWallets = c.walletBalances.filter((w) => w.type === BONUS_WALLET);
    const balance = bonusWallets.reduce((s, w) => s + w.balance, 0);
    // Покупки за 30 дней — из транзакций iiko (закрытые чеки CloseOrder).
    const txns = await getCustomerTransactions(c.id, PURCHASE_WINDOW_DAYS);
    const purchases30d = countPurchases(txns, PURCHASE_WINDOW_DAYS);
    // Уровень лояльности (стандарт / претендент на ПРО / ПРО) — считаем у себя:
    // iiko не помнит ни момент достижения, ни показывали ли гостю уведомление.
    const loyalty = resolveLoyalty({
      customerId: c.id,
      categories: c.categories.length ? c.categories : [c.category],
      purchases30d,
    });

    res.json({
      id: c.id,
      name: c.name,
      surname: c.surname,
      phone: c.phone,
      category: c.category,
      cardTrack: c.cards[0]?.track ?? null,
      balance: Math.round(balance * 100) / 100,
      purchases30d,
      status: loyalty.status,
      contenderUntil: loyalty.contenderUntil,
      notifyContender: loyalty.notifyContender,
      // Кошелёк для операций по умолчанию — первый бонусный.
      walletId: bonusWallets[0]?.id ?? null,
      wallets: bonusWallets.map((w) => ({
        id: w.id,
        name: w.name,
        balance: w.balance,
      })),
    });

    // Вход в mini-app → авто-подтягивание гостя в админку (фоново, один раз).
    ensureGuestBackfilled(c.id, c.phone).then(
      (n) => {
        if (n > 0) {
          // eslint-disable-next-line no-console
          console.log(`[customer] auto-backfill on login: ${c.id} (+${n} чеков)`);
        }
      },
      (e) => {
        // eslint-disable-next-line no-console
        console.error("[customer] auto-backfill error:", e);
      },
    );
  }),
);

/**
 * История начислений/списаний гостя — напрямую из iiko (без вебхуков).
 * Окно 90 дней. Пагинация: ?page=0&pageSize=10 → { transactions, page, hasMore }.
 */
router.get(
  "/customer/:id/transactions",
  h(async (req, res) => {
    const page = Math.max(0, Number(req.query.page ?? 0) || 0);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 10) || 10));
    const txns = await getCustomerTransactions(req.params.id, HISTORY_WINDOW_DAYS);
    const history = toHistory(txns);
    const start = page * pageSize;
    const slice = history.slice(start, start + pageSize);
    res.json({
      transactions: slice,
      page,
      pageSize,
      total: history.length,
      hasMore: start + pageSize < history.length,
    });
  }),
);

/** Отметить, что гостю показали модал «вы стали претендентом на ПРО». */
router.post(
  "/customer/:id/contender-seen",
  h(async (req, res) => {
    markContenderNotified(req.params.id);
    res.json({ ok: true });
  }),
);

/** QR карты лояльности. ?format=svg|png (по умолчанию png), ?content=<track>. */
router.get(
  "/customer/:id/qr",
  h(async (req, res) => {
    const content = String(req.query.content ?? req.params.id);
    if (String(req.query.format) === "svg") {
      res.type("image/svg+xml").send(await qrSvg(content));
    } else {
      const png = await qrPng(content, Number(req.query.size ?? 512));
      res.type("image/png").send(png);
    }
  }),
);

/** Начислить бонусы (наш вызов iiko + запись в журнал). */
router.post(
  "/wallet/topup",
  h(async (req, res) => {
    const { customerId, walletId, sum, comment, orderSum, place } = req.body ?? {};
    if (!customerId || !walletId || !(sum > 0)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const { transactionId } = await walletTopup({ customerId, walletId, sum, comment });
    await addEntry({
      id: transactionId,
      customerId,
      date: new Date().toISOString(),
      kind: "accrual",
      points: sum,
      orderSum: orderSum ?? null,
      place: place ?? null,
      source: "api",
    });
    res.json({ ok: true, transactionId });
  }),
);

/** Списать бонусы (наш вызов iiko + запись в журнал). */
router.post(
  "/wallet/chargeoff",
  h(async (req, res) => {
    const { customerId, walletId, sum, comment, orderSum, place } = req.body ?? {};
    if (!customerId || !walletId || !(sum > 0)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const { transactionId } = await walletChargeoff({ customerId, walletId, sum, comment });
    await addEntry({
      id: transactionId,
      customerId,
      date: new Date().toISOString(),
      kind: "redemption",
      points: -sum,
      orderSum: orderSum ?? null,
      place: place ?? null,
      source: "api",
    });
    res.json({ ok: true, transactionId });
  }),
);

/**
 * Приём вебхуков iiko. iiko шлёт события (в т.ч. по закрытию чека) — из них
 * извлекаем начисления/списания бонусов и пишем в журнал.
 * Опциональная проверка секрета через ?secret= или заголовок.
 */
router.post(
  "/webhooks/iiko",
  h(async (req, res) => {
    if (config.webhookSecret) {
      // iiko передаёт authToken в заголовке Authorization (может быть с Bearer).
      const auth = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const provided =
        req.query.secret ?? req.header("x-iiko-webhook-secret") ?? auth;
      if (provided !== config.webhookSecret) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
    }
    const events = Array.isArray(req.body) ? req.body : [req.body];
    // Лог первого события для настройки маппинга (снять формат eventInfo).
    if (events[0]) {
      // eslint-disable-next-line no-console
      console.log("[webhook] event:", JSON.stringify(events[0]).slice(0, 1500));
    }
    const saved: JournalEntry[] = [];
    let ingested = 0;
    const newGuestIds = new Set<string>();
    for (const ev of events) {
      // Учитываем только организацию лояльности «Долина Кофе» (Дворцовая 8).
      // Заказы точек «Сандо» (Карла Маркса, Московское шоссе) в лояльность
      // не идут. Если org в событии не пришла — не режем (совместимость).
      if (
        config.iiko.organizationId &&
        ev?.organizationId &&
        ev.organizationId !== config.iiko.organizationId
      ) {
        continue;
      }

      // 1) Админ-панель: закрытый чек → база гостей + дневной агрегат.
      const check = parseWebhookEvent(ev);
      if (check) {
        const r = ingestCheck(check);
        if (r.newOrder) ingested++;
        // Новый гость → авто-бэкфилл истории по iiko-id (телефон в чеке не нужен:
        // добудем его через customer/info по id).
        if (r.newGuest) newGuestIds.add(check.guestIikoId);
      }

      // 2) Журнал бонусов (legacy). Ожидаем поля walletChange/points.
      const customerId = ev?.customerId ?? ev?.customer?.id;
      const delta = Number(ev?.walletChange ?? ev?.points ?? 0);
      if (!customerId || !delta) continue;
      const entry: JournalEntry = {
        id: ev?.transactionId ?? crypto.randomUUID(),
        customerId,
        date: ev?.timestamp ?? new Date().toISOString(),
        kind: delta >= 0 ? "accrual" : "redemption",
        points: delta,
        orderSum: ev?.orderSum ?? null,
        place: ev?.place ?? ev?.terminalGroupName ?? null,
        source: "webhook",
      };
      await addEntry(entry);
      saved.push(entry);
    }
    res.json({ ok: true, saved: saved.length, ingested });

    // Фоново (после ответа iiko): подтянуть годовую историю новых гостей по id.
    if (newGuestIds.size) {
      backfillManyById([...newGuestIds]).then(
        (r) => {
          // eslint-disable-next-line no-console
          console.log(
            "[webhook] auto-backfill:",
            r.results.map((x) => `${x.phone}:${x.status}(${x.checksImported ?? 0})`).join(", "),
          );
        },
        (e) => {
          // eslint-disable-next-line no-console
          console.error("[webhook] auto-backfill error:", e);
        },
      );
    }
  }),
);

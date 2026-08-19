/** Конфигурация из окружения. Секреты — только из .env, не в коде. */

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),

  iiko: {
    base: process.env.IIKO_API_BASE ?? "https://api-ru.iiko.services",

    // v1 (iikoCloud, обычный ресторанный ключ): POST /api/1/access_token { apiLogin }
    apiLogin: process.env.IIKO_API_LOGIN ?? "",

    // v2 (partner/marketplace): POST /api/v2/access_token { apiKey, clientSecret, appId }
    apiKey: process.env.IIKO_API_KEY ?? "",
    clientSecret: process.env.IIKO_CLIENT_SECRET ?? "",
    appId: process.env.IIKO_APP_ID ?? "",

    // Организация лояльности. Если не задана — берём первую из /organizations.
    organizationId: process.env.IIKO_ORGANIZATION_ID ?? "",

    // Внешнее меню iiko «Меню для Долины» (для дистанционного заказа).
    externalMenuId: process.env.IIKO_EXTERNAL_MENU_ID ?? "87624",

    // Терминал, куда уходит дистанционный заказ (касса «Долина Кофе»).
    terminalGroupId:
      process.env.IIKO_TERMINAL_GROUP_ID ?? "4f36d2c7-71b1-7b14-0179-22c3824b00cf",

    // Метка источника заказа — чтобы на кассе отличать заказы из приложения.
    orderSourceKey: process.env.IIKO_ORDER_SOURCE_KEY ?? "pwa_app",
  },

  // Секрет для проверки входящих вебхуков iiko (если настроен).
  webhookSecret: process.env.IIKO_WEBHOOK_SECRET ?? "",

  // Путь к файлу-журналу операций (в Docker — на volume).
  journalPath: process.env.JOURNAL_PATH ?? "./data/journal.json",

  // iikoServer API (для OLAP-отчётов). Отдельный сервер офиса, не облако.
  // Доступы — только здесь, на сервере. Пусто = страница отчётов в заглушке.
  resto: {
    host: (process.env.IIKO_RESTO_HOST ?? "").replace(/\/+$/, ""),
    login: process.env.IIKO_RESTO_LOGIN ?? "",
    pass: process.env.IIKO_RESTO_PASS ?? "",
    passSha1: process.env.IIKO_RESTO_PASS_SHA1 ?? "",
  },

  // CORS: разрешённый origin фронта.
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  // Дистанционный заказ: создавать РЕАЛЬНЫЙ заказ в iiko (true) или работать в
  // режиме заглушки (false) — пока не настроены онлайн-оплата и внешнее меню.
  orderLive: process.env.ORDER_LIVE === "1" || process.env.ORDER_LIVE === "true",
};

/** Какой флоу авторизации использовать: v2 если заданы его поля, иначе v1. */
export function iikoAuthMode(): "v1" | "v2" {
  return config.iiko.clientSecret && config.iiko.appId ? "v2" : "v1";
}

export { req };

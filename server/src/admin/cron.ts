import cron from "node-cron";
import { refreshRecent } from "./backfill.js";
import { autoRefreshFavorites } from "./olap-favorites.js";

/**
 * Плановое обновление лояльности. Push-вебхук iiko ненадёжен, поэтому свежесть
 * держим пулом: каждую ночь подтягиваем чеки известных гостей за последние
 * 2 недели и пересчитываем недели окна (снимки/сегменты/задачи).
 * Часовой пояс сервера. Cron: 03:15 ежедневно.
 */
export function startAdminCron(): void {
  cron.schedule("15 3 * * *", () => {
    void (async () => {
      try {
        const r = await refreshRecent(14);
        // eslint-disable-next-line no-console
        console.log(
          `[admin cron] refresh done${r.throttled ? " (THROTTLED — прерван, IP остывает)" : ""}: резолв +${r.resolved}, чеков +${r.imported}, ошибок ${r.errors}, гостей ${r.guests}, недель ${r.weeksRebuilt.length}`,
        );
        // Любимое из OLAP (если доступы к iikoServer заданы) — раз в ночь.
        try {
          const f = await autoRefreshFavorites(90);
          if (!f.skipped) {
            // eslint-disable-next-line no-console
            console.log(
              `[admin cron] favorites from OLAP: гостей ${f.matchedGuests}, позиций ${f.ingested}, не сопоставлено ${f.unmatched}`,
            );
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[admin cron] favorites OLAP error", e);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[admin cron] error", e);
      }
    })();
  });
  // eslint-disable-next-line no-console
  console.log("[admin cron] scheduled daily 03:15 (pull refresh)");
}

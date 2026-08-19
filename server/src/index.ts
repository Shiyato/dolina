import express from "express";
import cors from "cors";
import { config, iikoAuthMode } from "./config.js";
import { router } from "./routes.js";
import { adminRouter } from "./admin/routes.js";
import { seedAdmin } from "./admin/auth.js";
import { startAdminCron } from "./admin/cron.js";

const app = express();

// CORS: прод-origin из конфига + localhost для разработки.
const allowedOrigins = new Set(
  config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean),
);
app.use(
  cors({
    origin(origin, cb) {
      // Запросы без Origin (curl, health-checks) — пропускаем.
      if (!origin) return cb(null, true);
      if (allowedOrigins.has("*") || allowedOrigins.has(origin))
        return cb(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
      return cb(null, false);
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", router);
app.use("/api/admin", adminRouter);

// Инициализация админ-панели: сид первого админа + плановый пересчёт.
seedAdmin();
startAdminCron();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[dolina-api] listening on :${config.port} · iiko auth mode: ${iikoAuthMode()} · base ${config.iiko.base}`,
  );
});

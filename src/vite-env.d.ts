/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Режим VK-авторизации: "real" (VK ID SDK) или "mock" (dev-заглушка). */
  readonly VITE_VK_MODE?: "real" | "mock";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

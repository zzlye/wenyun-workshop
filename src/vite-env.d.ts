/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __DEV_PROXY_CONFIG__: unknown
declare const process: {
  env: {
    NEXT_PUBLIC_APP_VERSION?: string
    NEXT_PUBLIC_APP_RELEASES?: string
  }
}

interface ImportMetaEnv {
  readonly VITE_DEFAULT_API_URL?: string
  readonly VITE_API_PROXY_AVAILABLE?: string
  readonly VITE_IMAGE_TASKS_AVAILABLE?: string
  readonly VITE_API_PROXY_LOCKED?: string
  readonly VITE_DOCKER_DEPLOYMENT?: string
  readonly VITE_DOCKER_LEGACY_API_URL_USED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

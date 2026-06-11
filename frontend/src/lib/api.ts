export function apiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined
  if (typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname)) {
    return ""
  }
  return envUrl || "http://localhost:1337"
}

export const API_URL = apiBaseUrl()

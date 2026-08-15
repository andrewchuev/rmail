import { invoke, isTauri } from "@tauri-apps/api/core";

export type BackgroundSettings = {
  enabled: boolean;
  hideOnClose: boolean;
  intervalMinutes: number;
  notifications: boolean;
};

const storageKey = "rmail.background-settings";
const defaults: BackgroundSettings = {
  enabled: true,
  hideOnClose: true,
  intervalMinutes: 5,
  notifications: true,
};

export function loadBackgroundSettings(): BackgroundSettings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}") };
  } catch {
    return defaults;
  }
}

export function saveBackgroundSettings(settings: BackgroundSettings): void {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

export async function applyWindowSettings(settings: BackgroundSettings): Promise<void> {
  if (isTauri()) {
    await invoke("set_hide_on_close", { enabled: settings.hideOnClose });
  }
}

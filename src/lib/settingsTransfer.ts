import { invoke } from "@tauri-apps/api/core";

// localStorage keys that make up the app-level preferences carried in an export.
const preferenceKeys = ["rmail.background-settings", "ui-theme", "ui-preset", "ui-zoom-level"];

export type ExportSummary = {
  accounts: number;
  accountsWithoutSecret: number;
};

export type ImportSummary = {
  appPreferences: unknown;
  accountsAdded: number;
  accountsSkipped: number;
  exclusionsAdded: number;
  failures: string[];
};

export function collectAppPreferences(): Record<string, string> {
  const preferences: Record<string, string> = {};
  for (const key of preferenceKeys) {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) preferences[key] = value;
    } catch {
      // Storage can be unavailable; export what is readable.
    }
  }
  return preferences;
}

export function applyAppPreferences(preferences: unknown): void {
  if (!preferences || typeof preferences !== "object") return;
  for (const key of preferenceKeys) {
    const value = (preferences as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore: the preference simply keeps its current value.
    }
  }
}

export function exportSettings(path: string, passphrase: string): Promise<ExportSummary> {
  return invoke<ExportSummary>("export_settings", {
    input: { path, passphrase, appPreferences: collectAppPreferences() },
  });
}

export function importSettings(path: string, passphrase: string): Promise<ImportSummary> {
  return invoke<ImportSummary>("import_settings", { input: { path, passphrase } });
}

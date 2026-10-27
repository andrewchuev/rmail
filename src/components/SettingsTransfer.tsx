import { useState, type FormEvent } from "react";
import { ArchiveRestore } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { applyAppPreferences, exportSettings, importSettings } from "@/lib/settingsTransfer";

type Mode = "export" | "import";

const fileFilters = [{ name: "RMail settings", extensions: ["rmail"] }];
const minPasswordLength = 8;

function reasonMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : String(reason || fallback);
}

export function SettingsTransfer() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isBusy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectMode(next: Mode | null) {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setError(null);
    setMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    setError(null);
    setMessage(null);

    if (mode === "export") {
      if (password.length < minPasswordLength) {
        setError(`Use a password of at least ${minPasswordLength} characters.`);
        return;
      }
      if (password !== confirmation) {
        setError("The passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "export") {
        const path = await save({ defaultPath: "rmail-settings.rmail", filters: fileFilters });
        if (!path) return;
        const summary = await exportSettings(path, password);
        const missing = summary.accountsWithoutSecret
          ? ` ${summary.accountsWithoutSecret} without a stored password or token.`
          : "";
        selectMode(null);
        setMessage(`Settings exported: ${summary.accounts} accounts.${missing}`);
      } else {
        const path = await open({ multiple: false, directory: false, filters: fileFilters });
        if (typeof path !== "string") return;
        const summary = await importSettings(path, password);
        applyAppPreferences(summary.appPreferences);
        const failed = summary.failures.length ? ` Failed: ${summary.failures.join("; ")}.` : "";
        selectMode(null);
        setMessage(`Settings imported: ${summary.accountsAdded} accounts added, ${summary.accountsSkipped} already present. Reloading…${failed}`);
        window.setTimeout(() => window.location.reload(), summary.failures.length ? 4000 : 1500);
      }
    } catch (reason) {
      setError(reasonMessage(reason, "The operation failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5" id="settings-transfer">
      <div className="flex items-center gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ArchiveRestore className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Export and import settings</span>
          <span className="mt-1 block text-sm text-muted-foreground">Move preferences, accounts (including passwords and Gmail tokens), and notification exclusions to another computer. The file is encrypted with a password you choose. Importing merges: accounts with the same address are kept as they are.</span>
        </span>
        <div className="flex shrink-0 gap-2">
          <Button disabled={isBusy} onClick={() => selectMode(mode === "export" ? null : "export")} size="sm" type="button" variant={mode === "export" ? "secondary" : "outline"}>Export…</Button>
          <Button disabled={isBusy} onClick={() => selectMode(mode === "import" ? null : "import")} size="sm" type="button" variant={mode === "import" ? "secondary" : "outline"}>Import…</Button>
        </div>
      </div>

      {mode ? (
        <form className="mt-4 grid max-w-md gap-3 pl-14" onSubmit={(event) => void handleSubmit(event)}>
          {mode === "export" ? (
            <p className="text-sm text-muted-foreground">The file contains your account passwords. Keep it and its password safe: the password cannot be recovered.</p>
          ) : null}
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{mode === "export" ? "File password" : "Password of the settings file"}</span>
            <input autoComplete="new-password" autoFocus className="rounded-md border bg-background px-3 py-2" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </label>
          {mode === "export" ? (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Repeat password</span>
              <input autoComplete="new-password" className="rounded-md border bg-background px-3 py-2" onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} />
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button disabled={isBusy || !password} size="sm" type="submit">
              {isBusy ? "Working…" : mode === "export" ? "Choose file and export" : "Choose file and import"}
            </Button>
            <Button disabled={isBusy} onClick={() => selectMode(null)} size="sm" type="button" variant="ghost">Cancel</Button>
          </div>
        </form>
      ) : null}

      {message ? <p className="mt-3 pl-14 text-sm text-emerald-700 dark:text-emerald-400" role="status">{message}</p> : null}
      {error ? <p className="mt-3 pl-14 text-sm text-destructive-text" role="alert">{error}</p> : null}
    </div>
  );
}

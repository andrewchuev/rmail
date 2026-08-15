import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AppWindow, ArrowLeft, Bell, Clock3, Mail, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  reconnectGmail,
  testMailConnection,
  updateAccount,
  type Account,
  type UpdateAccountInput,
} from "@/lib/accounts";
import { readCredential, saveCredentials } from "@/lib/credentials";
import { enable as enableAutostart, isEnabled as isAutostartEnabled, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import type { BackgroundSettings } from "@/lib/settings";
import { connectionErrorMessage } from "@/lib/errors";
import { ThemeSwitcher } from "./ThemeSwitcher";

type SettingsPageProps = {
  accounts: Account[];
  backgroundSettings: BackgroundSettings;
  onAccountUpdated: (account: Account) => void;
  onAddAccount: () => void;
  onBack: () => void;
  onBackgroundSettingsChange: (settings: BackgroundSettings) => void;
};

type SearchEntry = {
  description: string;
  id: string;
  keywords: string;
  title: string;
};

const generalEntries: SearchEntry[] = [
  {
    id: "appearance-theme",
    title: "Appearance & Theme",
    description: "Customize the application colors and light/dark mode.",
    keywords: "general settings appearance theme light dark mode color preset UI",
  },
  {
    id: "background-enabled",
    title: "Background email checks",
    description: "Automatically retrieve new messages while RMail is running.",
    keywords: "general settings background synchronization sync retrieve refresh email check",
  },
  {
    id: "background-interval",
    title: "Check frequency",
    description: "How often to check all connected accounts.",
    keywords: "general settings interval frequency minutes schedule timer",
  },
  {
    id: "background-notifications",
    title: "System notifications",
    description: "Show a notification when new messages arrive.",
    keywords: "general settings notification alert banner new messages tray",
  },
  {
    id: "window-hide-on-close",
    title: "Minimize to tray",
    description: "Hide the window when closed so background checks can continue.",
    keywords: "general settings window close hide minimize tray quit exit",
  },
  {
    id: "system-autostart",
    title: "Launch at system startup",
    description: "Start RMail automatically when you log in to your computer.",
    keywords: "general settings startup autostart boot login launch windows system",
  },
];

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU");
}

function scoreEntry(entry: SearchEntry, query: string) {
  const title = normalize(entry.title);
  const searchable = normalize(`${entry.title} ${entry.description} ${entry.keywords}`);
  if (title.startsWith(query)) return 3;
  if (title.includes(query)) return 2;
  if (searchable.includes(query)) return 1;
  return 0;
}

function reasonMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : String(reason || fallback);
}

function AccountCredentialsEditor({
  account,
  onUpdated,
}: {
  account: Account;
  onUpdated: (account: Account) => void;
}) {
  const [input, setInput] = useState<UpdateAccountInput>(() => ({
    id: account.id,
    displayName: account.displayName,
    email: account.email,
    imapHost: account.imapHost,
    smtpHost: account.smtpHost,
  }));
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    setInput({
      id: account.id,
      displayName: account.displayName,
      email: account.email,
      imapHost: account.imapHost,
      smtpHost: account.smtpHost,
    });
    setPassword("");
    setError(null);
    setMessage(null);
  }, [account]);

  function updateField(field: keyof UpdateAccountInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setMessage(null);
  }

  async function savePasswordAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    setSaving(true);
    let connectionWasAttempted = false;
    let connectionWasVerified = false;
    try {
      const previousPassword = await readCredential(account.id, "imapPassword");
      const connectionPassword = password || previousPassword;
      if (!connectionPassword) {
        throw new Error("The current account password was not found in the vault. Please enter it again.");
      }
      connectionWasAttempted = true;
      await testMailConnection({
        imapHost: input.imapHost,
        imapPort: 993,
        smtpHost: input.smtpHost,
        smtpPort: 587,
        username: input.email,
        password: connectionPassword,
      });
      connectionWasVerified = true;

      if (password) {
        await saveCredentials(account.id, password);
      }
      try {
        const updated = await updateAccount(input);
        onUpdated(updated);
        setPassword("");
        setMessage("Account settings were verified and saved.");
      } catch (reason) {
        if (password && previousPassword) {
          await saveCredentials(account.id, previousPassword).catch(() => undefined);
        }
        throw reason;
      }
    } catch (reason) {
      setError(connectionWasVerified
        ? reasonMessage(reason, "Unable to save the account changes.")
        : connectionWasAttempted
          ? connectionErrorMessage(reason)
          : reasonMessage(reason, "Unable to access the account credentials."));
    } finally {
      setSaving(false);
    }
  }

  async function reconnectGoogle() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      onUpdated(await reconnectGmail(account.id));
      setMessage("Google access was refreshed.");
    } catch (reason) {
      setError(reasonMessage(reason, "Unable to reconnect Google."));
    } finally {
      setSaving(false);
    }
  }

  if (account.authType === "gmail_oauth") {
    return (
      <article className="rounded-xl border bg-card p-5" id={`account-${account.id}`}>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-red-50 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">G</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{account.displayName}</h3>
            <p className="truncate text-sm text-muted-foreground">{account.email}</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Authentication is managed by Google OAuth. Reconnecting replaces the refresh token only after you sign in to the same account.</p>
            <Button className="mt-4" disabled={isSaving} onClick={() => void reconnectGoogle()} type="button" variant="secondary">
              {isSaving ? "Waiting for Google…" : "Reconnect Google"}
            </Button>
            {message ? <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400" role="status">{message}</p> : null}
            {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-xl border bg-card p-5" id={`account-${account.id}`}>
      <div className="mb-5 flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Mail className="size-5" /></span>
        <div className="min-w-0">
          <h3 className="font-semibold">{account.displayName}</h3>
          <p className="truncate text-sm text-muted-foreground">{account.email}</p>
        </div>
      </div>
      <form className="grid gap-4" onSubmit={savePasswordAccount}>
        <label className="setup-field">
          <span>Account name</span>
          <input onChange={(event) => updateField("displayName", event.target.value)} required value={input.displayName} />
        </label>
        <label className="setup-field">
          <span>Email address</span>
          <input onChange={(event) => updateField("email", event.target.value)} required type="email" value={input.email} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="setup-field">
            <span>IMAP server</span>
            <input onChange={(event) => updateField("imapHost", event.target.value)} required value={input.imapHost} />
          </label>
          <label className="setup-field">
            <span>SMTP server</span>
            <input onChange={(event) => updateField("smtpHost", event.target.value)} required value={input.smtpHost} />
          </label>
        </div>
        <label className="setup-field">
          <span>New email password</span>
          <input autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank to keep the current password" type="password" value={password} />
          <small>RMail verifies IMAP and SMTP with these settings before saving.</small>
        </label>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{message}</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <Button className="justify-self-start" disabled={isSaving} type="submit">
          {isSaving ? "Verifying and saving…" : "Verify and save"}
        </Button>
      </form>
    </article>
  );
}

export function SettingsPage({
  accounts,
  backgroundSettings,
  onAccountUpdated,
  onAddAccount,
  onBack,
  onBackgroundSettingsChange,
}: SettingsPageProps) {
  const [query, setQuery] = useState("");
  const [autostartState, setAutostartState] = useState<boolean>(false);

  useEffect(() => {
    isAutostartEnabled().then(setAutostartState).catch(console.error);
  }, []);

  const handleAutostartToggle = async (checked: boolean) => {
    try {
      if (checked) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      setAutostartState(checked);
    } catch (error) {
      console.error("Failed to toggle autostart:", error);
    }
  };

  const normalizedQuery = normalize(query);
  const accountEntries = useMemo<SearchEntry[]>(() => accounts.map((account) => ({
    id: `account-${account.id}`,
    title: account.displayName,
    description: account.email,
    keywords: `${account.authType === "gmail_oauth" ? "gmail google oauth token" : "imap smtp password"} account credentials login ${account.imapHost} ${account.smtpHost}`,
  })), [accounts]);
  const matches = useMemo(() => {
    const entries = [...generalEntries, ...accountEntries];
    if (!normalizedQuery) return entries.map((entry) => ({ entry, score: 1 }));
    return entries
      .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title, "ru"));
  }, [accountEntries, normalizedQuery]);
  const matchedIds = new Set(matches.map(({ entry }) => entry.id));
  const visibleGeneralEntries = generalEntries.filter((entry) => matchedIds.has(entry.id));
  const visibleAccounts = accounts.filter((account) => matchedIds.has(`account-${account.id}`));

  function selectSuggestion(id: string) {
    setQuery("");
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  return (
    <main className="min-h-svh bg-muted/35 text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <Button aria-label="Back to email" onClick={onBack} size="icon" type="button" variant="ghost"><ArrowLeft /></Button>
          <div>
            <p className="text-xs font-medium text-primary">RMail</p>
            <h1 className="text-xl font-semibold">Settings</h1>
          </div>
          <Button className="ml-auto" onClick={onAddAccount} type="button" variant="secondary"><Plus />Add account</Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="relative max-w-2xl">
          <label className="search-field h-12 border bg-background shadow-sm">
            <Search className="size-4" />
            <span className="sr-only">Search settings</span>
            <input autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder="Find a setting, account, or action" type="search" value={query} />
          </label>
          {normalizedQuery && matches.length ? (
            <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border bg-popover p-1 shadow-lg" role="listbox">
              {matches.slice(0, 6).map(({ entry }) => (
                <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" key={entry.id} onClick={() => selectSuggestion(entry.id)} role="option" type="button">
                  <span className="block text-sm font-medium">{entry.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!matches.length ? (
          <section className="mt-8 rounded-xl border bg-card px-6 py-12 text-center">
            <h2 className="font-semibold">No settings found</h2>
            <p className="mt-2 text-sm text-muted-foreground">Try “notifications”, “frequency”, “password”, or an account address.</p>
          </section>
        ) : null}

        {visibleGeneralEntries.length ? (
          <section className="mt-10" aria-labelledby="general-settings-title">
            <div className="mb-4">
              <h2 className="text-lg font-semibold" id="general-settings-title">General settings</h2>
              <p className="mt-1 text-sm text-muted-foreground">Background activity and system notifications.</p>
            </div>
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {matchedIds.has("appearance-theme") ? (
                <div id="appearance-theme">
                  <ThemeSwitcher />
                </div>
              ) : null}
              {matchedIds.has("background-enabled") ? (
                <label className="flex items-center gap-4 p-5" id="background-enabled">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Mail className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Background email checks</span><span className="mt-1 block text-sm text-muted-foreground">Automatically retrieve new messages while RMail is running.</span></span>
                  <input checked={backgroundSettings.enabled} onChange={(event) => onBackgroundSettingsChange({ ...backgroundSettings, enabled: event.target.checked })} type="checkbox" />
                </label>
              ) : null}
              {matchedIds.has("background-interval") ? (
                <label className="flex items-center gap-4 p-5" id="background-interval">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Clock3 className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Check frequency</span><span className="mt-1 block text-sm text-muted-foreground">How often to check all connected accounts.</span></span>
                  <select className="rounded-md border bg-background px-3 py-2 text-sm" disabled={!backgroundSettings.enabled} onChange={(event) => onBackgroundSettingsChange({ ...backgroundSettings, intervalMinutes: Number(event.target.value) })} value={backgroundSettings.intervalMinutes}>
                    <option value={1}>1 minute</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option>
                  </select>
                </label>
              ) : null}
              {matchedIds.has("background-notifications") ? (
                <label className="flex items-center gap-4 p-5" id="background-notifications">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Bell className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">System notifications</span><span className="mt-1 block text-sm text-muted-foreground">Show a notification when new messages arrive.</span></span>
                  <input checked={backgroundSettings.notifications} disabled={!backgroundSettings.enabled} onChange={(event) => onBackgroundSettingsChange({ ...backgroundSettings, notifications: event.target.checked })} type="checkbox" />
                </label>
              ) : null}
              {matchedIds.has("window-hide-on-close") ? (
                <label className="flex items-center gap-4 p-5" id="window-hide-on-close">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><AppWindow className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Minimize to tray</span><span className="mt-1 block text-sm text-muted-foreground">Hide the window when closed so background checks can continue.</span></span>
                  <input checked={backgroundSettings.hideOnClose} onChange={(event) => onBackgroundSettingsChange({ ...backgroundSettings, hideOnClose: event.target.checked })} type="checkbox" />
                </label>
              ) : null}
              {matchedIds.has("system-autostart") ? (
                <label className="flex items-center gap-4 p-5" id="system-autostart">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><AppWindow className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Launch at system startup</span><span className="mt-1 block text-sm text-muted-foreground">Start RMail automatically when you log in to your computer.</span></span>
                  <input checked={autostartState} onChange={(event) => handleAutostartToggle(event.target.checked)} type="checkbox" />
                </label>
              ) : null}
            </div>
          </section>
        ) : null}

        {visibleAccounts.length ? (
          <section className="mt-10 pb-12" aria-labelledby="account-settings-title">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div><h2 className="text-lg font-semibold" id="account-settings-title">Accounts</h2><p className="mt-1 text-sm text-muted-foreground">Connection settings and credentials for each email account.</p></div>
            </div>
            <div className="grid gap-4">{visibleAccounts.map((account) => <AccountCredentialsEditor account={account} key={account.id} onUpdated={onAccountUpdated} />)}</div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

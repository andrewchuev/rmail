import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AppWindow, ArrowLeft, Bell, Clock3, KeyRound, Mail, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  reconnectGmail,
  testMailConnection,
  updateAccount,
  type Account,
  type UpdateAccountInput,
} from "@/lib/accounts";
import { readCredential, saveCredentials } from "@/lib/credentials";
import type { BackgroundSettings } from "@/lib/settings";
import { connectionErrorMessage } from "@/lib/errors";

type SettingsPageProps = {
  accounts: Account[];
  backgroundSettings: BackgroundSettings;
  vaultPassword: string;
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
    id: "background-enabled",
    title: "Фоновая проверка почты",
    description: "Автоматически получать новые письма, пока RMail запущен.",
    keywords: "общие настройки фон синхронизация получать обновлять почта проверка",
  },
  {
    id: "background-interval",
    title: "Периодичность проверки",
    description: "Как часто проверять все подключённые ящики.",
    keywords: "общие настройки интервал частота минуты расписание таймер",
  },
  {
    id: "background-notifications",
    title: "Системные уведомления",
    description: "Показывать уведомление, когда появляются новые письма.",
    keywords: "общие настройки уведомления оповещения баннер новые письма tray трей",
  },
  {
    id: "window-hide-on-close",
    title: "Сворачивать в трей",
    description: "Скрывать окно при закрытии, чтобы фоновая проверка продолжалась.",
    keywords: "общие настройки окно закрыть закрытие скрыть свернуть трей tray выход",
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
  vaultPassword,
  onUpdated,
}: {
  account: Account;
  vaultPassword: string;
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
    if (!vaultPassword) {
      setError("Откройте хранилище перед изменением данных для входа.");
      return;
    }

    setSaving(true);
    let connectionWasAttempted = false;
    let connectionWasVerified = false;
    try {
      const previousPassword = await readCredential(account.id, "imapPassword", vaultPassword);
      if (!previousPassword) {
        throw new Error("Текущий пароль аккаунта не найден в хранилище.");
      }
      const connectionPassword = password || previousPassword;
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
        await saveCredentials(account.id, password, vaultPassword);
      }
      try {
        const updated = await updateAccount(input);
        onUpdated(updated);
        setPassword("");
        setMessage("Данные аккаунта проверены и сохранены.");
      } catch (reason) {
        if (password) {
          await saveCredentials(account.id, previousPassword, vaultPassword).catch(() => undefined);
        }
        throw reason;
      }
    } catch (reason) {
      setError(connectionWasVerified
        ? reasonMessage(reason, "Не удалось сохранить изменения аккаунта.")
        : connectionWasAttempted
          ? connectionErrorMessage(reason)
          : reasonMessage(reason, "Не удалось открыть данные аккаунта."));
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
      setMessage("Доступ к Google обновлён.");
    } catch (reason) {
      setError(reasonMessage(reason, "Не удалось переподключить Google."));
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
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Авторизация управляется Google OAuth. Переподключение заменит refresh token только после входа в этот же аккаунт.</p>
            <Button className="mt-4" disabled={isSaving} onClick={() => void reconnectGoogle()} type="button" variant="secondary">
              {isSaving ? "Ожидаем Google…" : "Переподключить Google"}
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
          <span>Название аккаунта</span>
          <input onChange={(event) => updateField("displayName", event.target.value)} required value={input.displayName} />
        </label>
        <label className="setup-field">
          <span>Электронная почта</span>
          <input onChange={(event) => updateField("email", event.target.value)} required type="email" value={input.email} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="setup-field">
            <span>IMAP-сервер</span>
            <input onChange={(event) => updateField("imapHost", event.target.value)} required value={input.imapHost} />
          </label>
          <label className="setup-field">
            <span>SMTP-сервер</span>
            <input onChange={(event) => updateField("smtpHost", event.target.value)} required value={input.smtpHost} />
          </label>
        </div>
        <label className="setup-field">
          <span>Новый пароль почты</span>
          <input autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} placeholder="Оставьте пустым, чтобы не менять" type="password" value={password} />
          <small>Перед сохранением RMail проверит IMAP и SMTP с указанными данными.</small>
        </label>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{message}</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <Button className="justify-self-start" disabled={isSaving} type="submit">
          {isSaving ? "Проверяем и сохраняем…" : "Проверить и сохранить"}
        </Button>
      </form>
    </article>
  );
}

export function SettingsPage({
  accounts,
  backgroundSettings,
  vaultPassword,
  onAccountUpdated,
  onAddAccount,
  onBack,
  onBackgroundSettingsChange,
}: SettingsPageProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalize(query);
  const accountEntries = useMemo<SearchEntry[]>(() => accounts.map((account) => ({
    id: `account-${account.id}`,
    title: account.displayName,
    description: account.email,
    keywords: `${account.authType === "gmail_oauth" ? "gmail google oauth токен" : "imap smtp пароль"} аккаунт учетные данные ${account.imapHost} ${account.smtpHost}`,
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
          <Button aria-label="Вернуться к почте" onClick={onBack} size="icon" type="button" variant="ghost"><ArrowLeft /></Button>
          <div>
            <p className="text-xs font-medium text-primary">RMail</p>
            <h1 className="text-xl font-semibold">Настройки</h1>
          </div>
          <Button className="ml-auto" onClick={onAddAccount} type="button" variant="secondary"><Plus />Добавить аккаунт</Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="relative max-w-2xl">
          <label className="search-field h-12 border bg-background shadow-sm">
            <Search className="size-4" />
            <span className="sr-only">Поиск по настройкам</span>
            <input autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder="Найдите настройку, аккаунт или действие" type="search" value={query} />
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
            <h2 className="font-semibold">Настройки не найдены</h2>
            <p className="mt-2 text-sm text-muted-foreground">Попробуйте запрос «уведомления», «интервал», «пароль» или адрес аккаунта.</p>
          </section>
        ) : null}

        {visibleGeneralEntries.length ? (
          <section className="mt-10" aria-labelledby="general-settings-title">
            <div className="mb-4">
              <h2 className="text-lg font-semibold" id="general-settings-title">Общие настройки</h2>
              <p className="mt-1 text-sm text-muted-foreground">Фоновая работа и системные уведомления.</p>
            </div>
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {matchedIds.has("background-enabled") ? (
                <label className="flex items-center gap-4 p-5" id="background-enabled">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Mail className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Фоновая проверка почты</span><span className="mt-1 block text-sm text-muted-foreground">Автоматически получать новые письма, пока RMail запущен.</span></span>
                  <input checked={backgroundSettings.enabled} onChange={(event) => onBackgroundSettingsChange({ ...backgroundSettings, enabled: event.target.checked })} type="checkbox" />
                </label>
              ) : null}
              {matchedIds.has("background-interval") ? (
                <label className="flex items-center gap-4 p-5" id="background-interval">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Clock3 className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Периодичность проверки</span><span className="mt-1 block text-sm text-muted-foreground">Как часто проверять все подключённые ящики.</span></span>
                  <select className="rounded-md border bg-background px-3 py-2 text-sm" disabled={!backgroundSettings.enabled} onChange={(event) => onBackgroundSettingsChange({ ...backgroundSettings, intervalMinutes: Number(event.target.value) })} value={backgroundSettings.intervalMinutes}>
                    <option value={1}>1 минута</option><option value={5}>5 минут</option><option value={15}>15 минут</option><option value={30}>30 минут</option><option value={60}>60 минут</option>
                  </select>
                </label>
              ) : null}
              {matchedIds.has("background-notifications") ? (
                <label className="flex items-center gap-4 p-5" id="background-notifications">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Bell className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Системные уведомления</span><span className="mt-1 block text-sm text-muted-foreground">Показывать уведомление, когда появляются новые письма.</span></span>
                  <input checked={backgroundSettings.notifications} disabled={!backgroundSettings.enabled} onChange={(event) => onBackgroundSettingsChange({ ...backgroundSettings, notifications: event.target.checked })} type="checkbox" />
                </label>
              ) : null}
              {matchedIds.has("window-hide-on-close") ? (
                <label className="flex items-center gap-4 p-5" id="window-hide-on-close">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><AppWindow className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Сворачивать в трей</span><span className="mt-1 block text-sm text-muted-foreground">Скрывать окно при закрытии, чтобы фоновая проверка продолжалась.</span></span>
                  <input checked={backgroundSettings.hideOnClose} onChange={(event) => onBackgroundSettingsChange({ ...backgroundSettings, hideOnClose: event.target.checked })} type="checkbox" />
                </label>
              ) : null}
            </div>
          </section>
        ) : null}

        {visibleAccounts.length ? (
          <section className="mt-10 pb-12" aria-labelledby="account-settings-title">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div><h2 className="text-lg font-semibold" id="account-settings-title">Аккаунты</h2><p className="mt-1 text-sm text-muted-foreground">Подключения и данные для входа каждого почтового ящика.</p></div>
              {!vaultPassword && visibleAccounts.some((account) => account.authType === "password") ? <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300"><KeyRound className="size-4" />Сначала откройте хранилище на странице почты.</p> : null}
            </div>
            <div className="grid gap-4">{visibleAccounts.map((account) => <AccountCredentialsEditor account={account} key={account.id} onUpdated={onAccountUpdated} vaultPassword={vaultPassword} />)}</div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

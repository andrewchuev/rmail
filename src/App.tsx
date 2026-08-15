import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Archive, ChevronDown, Clock3, Inbox, MoreHorizontal, Paperclip, PenLine, Plus, Search, Settings, Trash2 } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { SettingsPage } from "@/components/SettingsPage";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  createAccount,
  connectGmail,
  diagnosticLogPath,
  deleteDraft,
  deleteAccount,
  listAccounts,
  listCachedMailboxes,
  listCachedMessages,
  listUnifiedInbox,
  loadMessageBody,
  saveMessageAttachment,
  saveDraft,
  sendMessage,
  syncAccount,
  testMailConnection,
  type Account,
  type CachedMailbox,
  type CachedMessage,
  type CreateAccountInput,
  type Draft,
  type MessageBody,
} from "@/lib/accounts";
import {
  deleteCredentials,
  loadStoredVaultPassword,
  readCredential,
  saveCredentials,
  saveStoredVaultPassword,
} from "@/lib/credentials";
import { connectionErrorMessage } from "@/lib/errors";
import { applyWindowSettings, loadBackgroundSettings, saveBackgroundSettings, type BackgroundSettings } from "@/lib/settings";
import "./App.css";

function folderLabel(path: string) {
  return path.toUpperCase() === "INBOX" ? "Входящие" : path;
}

function attachmentFileName(name: string) {
  return name.replace(/[\\/]/g, "_").trim() || "attachment";
}

function messageKey(message: Pick<CachedMessage, "accountId" | "mailboxPath" | "uid">) {
  return `${message.accountId}:${message.mailboxPath}:${message.uid}`;
}

type ComposeState = {
  recipients: string;
  subject: string;
  body: string;
};

const emptyCompose: ComposeState = { recipients: "", subject: "", body: "" };

function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} onClick={onClick} size="icon" variant="ghost">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function AccountSetup({
  isAdditional = false,
  onAccountCreated,
  onCancel,
  onGmailConnected,
}: {
  isAdditional?: boolean;
  onAccountCreated: (account: Account, password: string, vaultPassword: string) => Promise<void>;
  onCancel?: () => void;
  onGmailConnected: (account: Account) => Promise<void>;
}) {
  const [input, setInput] = useState<CreateAccountInput>({
    displayName: "",
    email: "",
    imapHost: "",
    smtpHost: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [connectionPassword, setConnectionPassword] = useState("");
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultPasswordConfirmation, setVaultPasswordConfirmation] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [diagnosticLog, setDiagnosticLog] = useState<string | null>(null);
  const [isTesting, setTesting] = useState(false);
  const [isConnectionVerified, setConnectionVerified] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isGmailConnecting, setGmailConnecting] = useState(false);

  async function connectGoogleAccount() {
    setError(null);
    setGmailConnecting(true);
    try {
      await onGmailConnected(await connectGmail());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason || "Не удалось подключить Gmail."));
    } finally {
      setGmailConnecting(false);
    }
  }

  function updateField(field: keyof CreateAccountInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setConnectionVerified(false);
    setConnectionMessage(null);
  }

  async function testConnection() {
    setError(null);
    setConnectionMessage(null);
    setDiagnosticLog(null);
    setConnectionVerified(false);
    setTesting(true);

    try {
      const status = await testMailConnection({
        imapHost: input.imapHost,
        imapPort: 993,
        smtpHost: input.smtpHost,
        smtpPort: 587,
        username: input.email,
        password: connectionPassword,
      });
      setConnectionVerified(true);
      setConnectionMessage(`Подключение подтверждено: найдено папок — ${status.mailboxes.length}.`);
    } catch (reason) {
      setError(connectionErrorMessage(reason));
      void diagnosticLogPath().then(setDiagnosticLog).catch(() => undefined);
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isConnectionVerified) {
      setError("Сначала проверьте подключение.");
      return;
    }

    if (vaultPassword.length < 12) {
      setError("Пароль хранилища должен содержать не менее 12 символов.");
      return;
    }

    if (!isAdditional && vaultPassword !== vaultPasswordConfirmation) {
      setError("Пароли хранилища не совпадают.");
      return;
    }

    setSubmitting(true);

    try {
      const account = await createAccount(input);

      try {
        await saveCredentials(account.id, connectionPassword, vaultPassword);
        await saveStoredVaultPassword(vaultPassword).catch(() => undefined);
      } catch {
        await deleteCredentials(account.id, vaultPassword).catch(() => undefined);
        await deleteAccount(account.id).catch(() => undefined);
        throw new Error("Не удалось сохранить данные для входа. Аккаунт не был добавлен.");
      }

      await onAccountCreated(account, connectionPassword, vaultPassword);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background px-6 py-6">
      <section className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm" aria-labelledby="setup-title">
        <span className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">R</span>
        <p className="mt-7 text-sm font-medium text-primary">{isAdditional ? "Новый аккаунт" : "Первый аккаунт"}</p>
        <h1 id="setup-title" className="mt-1 text-2xl font-semibold tracking-tight">Подключите почту</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Проверьте доступ к IMAP и SMTP, затем защитите данные для входа паролем хранилища.
        </p>

        <Button className="mt-6 w-full" disabled={isGmailConnecting} onClick={() => void connectGoogleAccount()} type="button" variant="secondary">
          {isGmailConnecting ? "Ожидаем Google…" : "Подключить Gmail"}
        </Button>
        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>или IMAP вручную</span><span className="h-px flex-1 bg-border" /></div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="setup-field">
            <span>Название аккаунта</span>
            <input onChange={(event) => updateField("displayName", event.target.value)} placeholder="Рабочая почта" required value={input.displayName} />
          </label>
          <label className="setup-field">
            <span>Электронная почта</span>
            <input onChange={(event) => updateField("email", event.target.value)} placeholder="name@company.com" required type="email" value={input.email} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="setup-field">
              <span>IMAP-сервер</span>
              <input onChange={(event) => updateField("imapHost", event.target.value)} placeholder="imap.company.com" required value={input.imapHost} />
            </label>
            <label className="setup-field">
              <span>SMTP-сервер</span>
              <input onChange={(event) => updateField("smtpHost", event.target.value)} placeholder="smtp.company.com" required value={input.smtpHost} />
            </label>
          </div>
          <label className="setup-field">
            <span>Пароль почты</span>
            <input
              onChange={(event) => {
                setConnectionPassword(event.target.value);
                setConnectionVerified(false);
                setConnectionMessage(null);
              }}
              required
              type="password"
              value={connectionPassword}
            />
            <small>IMAP: SSL/TLS, порт 993 · SMTP: STARTTLS, порт 587</small>
          </label>
          <Button className="w-full" disabled={isTesting} onClick={() => void testConnection()} type="button" variant="secondary">
            {isTesting ? "Проверяем подключение…" : "Проверить подключение"}
          </Button>
          {connectionMessage ? <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{connectionMessage}</p> : null}
          <label className="setup-field">
            <span>{isAdditional ? "Пароль текущего хранилища" : "Пароль хранилища"}</span>
            <input
              onChange={(event) => setVaultPassword(event.target.value)}
              required
              type="password"
              value={vaultPassword}
            />
            <small>{isAdditional ? "Используйте пароль, которым уже защищены подключённые аккаунты." : "Не менее 12 символов. Он будет сохранён в защищённом хранилище системы."}</small>
          </label>
          {isAdditional ? null : <label className="setup-field">
            <span>Повторите пароль хранилища</span>
            <input
              onChange={(event) => setVaultPasswordConfirmation(event.target.value)}
              required
              type="password"
              value={vaultPasswordConfirmation}
            />
          </label>}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          {diagnosticLog ? <p className="text-xs leading-5 text-muted-foreground">Диагностический журнал: <code className="break-all">{diagnosticLog}</code></p> : null}
          <Button className="mt-2 w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Сохраняем…" : "Продолжить"}
          </Button>
          {onCancel ? <Button className="w-full" onClick={onCancel} type="button" variant="ghost">Отмена</Button> : null}
        </form>
      </section>
    </main>
  );
}

function App() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<CachedMailbox[]>([]);
  const [cachedMessages, setCachedMessages] = useState<CachedMessage[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const [activeFolder, setActiveFolder] = useState("INBOX");
  const [selectedMessageKey, setSelectedMessageKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isComposeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [composeMessage, setComposeMessage] = useState<string | null>(null);
  const [isSavingDraft, setSavingDraft] = useState(false);
  const [isSending, setSending] = useState(false);
  const [syncMessage, setSyncMessage] = useState("Откройте хранилище, чтобы синхронизировать почту");
  const [syncRevision, setSyncRevision] = useState(0);
  const [vaultPassword, setVaultPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState<MessageBody | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [isBodyLoading, setBodyLoading] = useState(false);
  const [contentMode, setContentMode] = useState<"text" | "html">("text");
  const [savingAttachmentPosition, setSavingAttachmentPosition] = useState<number | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [isAddingAccount, setAddingAccount] = useState(false);
  const [isSyncing, setSyncing] = useState(false);
  const [composeAccountId, setComposeAccountId] = useState<number | null>(null);
  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>(loadBackgroundSettings);
  const [activeView, setActiveView] = useState<"mail" | "settings">("mail");
  const hasCompletedBackgroundSync = useRef(false);
  const knownMessageKeys = useRef<Set<string>>(new Set());

  const visibleMessages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return cachedMessages;
    }

    return cachedMessages.filter((message) =>
      [message.sender, message.subject]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [cachedMessages, query]);

  const selectedMessage = cachedMessages.find(
    (message) => messageKey(message) === selectedMessageKey,
  ) ?? null;

  async function accountCredential(account: Account, name: "imapPassword" | "smtpPassword") {
    if (account.authType === "gmail_oauth") {
      return "";
    }
    if (!vaultPassword) {
      throw new Error("Откройте хранилище, чтобы продолжить.");
    }
    const password = await readCredential(account.id, name, vaultPassword);
    if (!password) {
      throw new Error("Данные для входа не найдены в хранилище.");
    }
    return password;
  }

  useEffect(() => {
    let ignore = false;

    void listAccounts()
      .then((items) => {
        if (!ignore) {
          setAccounts(items);
        }
      })
      .catch((reason) => {
        if (!ignore) {
          setLoadError(reason instanceof Error ? reason.message : "Unable to load accounts.");
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    saveBackgroundSettings(backgroundSettings);
    void applyWindowSettings(backgroundSettings).catch(() => undefined);
  }, [backgroundSettings]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("tray-show", () => {
      void getCurrentWindow().show().then(() => getCurrentWindow().setFocus());
    }).then((listener) => {
      unlisten = listener;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("tray-sync", () => void syncAllAccounts()).then((listener) => {
      unlisten = listener;
    });
    return () => unlisten?.();
  }, [vaultPassword, accounts]);

  useEffect(() => {
    void loadStoredVaultPassword()
      .then((password) => {
        if (password) {
          setVaultPassword(password);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (activeAccountId === null) {
      setMailboxes([]);
      return;
    }
    const account = accounts?.find((item) => item.id === activeAccountId);
    if (!account) return;
    let ignore = false;

    void listCachedMailboxes(account.id)
      .then((items) => {
        if (ignore) {
          return;
        }
        setMailboxes(items);
        setActiveFolder((current) => items.some((mailbox) => mailbox.path === current) ? current : (items[0]?.path ?? "INBOX"));
      })
      .catch(() => {
        if (!ignore) {
          setSyncMessage("Не удалось загрузить локальный кеш");
        }
      });

    return () => {
      ignore = true;
    };
  }, [accounts, activeAccountId, syncRevision]);

  useEffect(() => {
    if (!accounts?.length) {
      return;
    }
    let ignore = false;

    const loadMessages = activeAccountId === null
      ? listUnifiedInbox()
      : listCachedMessages(activeAccountId, activeFolder);
    void loadMessages
      .then((items) => {
        if (ignore) {
          return;
        }
        setCachedMessages(items);
        setSelectedMessageKey(items[0] ? messageKey(items[0]) : null);
        setContentMode("text");
        setAttachmentMessage(null);
      })
      .catch(() => {
        if (!ignore) {
          setSyncMessage("Не удалось загрузить письма из кеша");
        }
      });

    return () => {
      ignore = true;
    };
  }, [accounts, activeAccountId, activeFolder, syncRevision]);

  useEffect(() => {
    const message = selectedMessage;
    const account = message ? accounts?.find((item) => item.id === message.accountId) : null;
    if (!account || !message || (account.authType !== "gmail_oauth" && !vaultPassword)) {
      setMessageBody(null);
      setBodyError(null);
      setBodyLoading(false);
      return;
    }
    let ignore = false;

    setMessageBody(null);
    setBodyLoading(true);
    setBodyError(null);
    void accountCredential(account, "imapPassword")
      .then((password) => loadMessageBody(account.id, message.mailboxPath, message.uid, password))
      .then((body) => {
        if (!ignore) {
          setMessageBody(body);
        }
      })
      .catch((reason) => {
        if (!ignore) {
          setBodyError(reason instanceof Error ? reason.message : "Не удалось загрузить письмо.");
        }
      })
      .finally(() => {
        if (!ignore) {
          setBodyLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [accounts, selectedMessage, vaultPassword]);

  useEffect(() => {
    if (
      !backgroundSettings.enabled
      || !accounts?.length
      || (!vaultPassword && accounts.every((account) => account.authType === "password"))
    ) return;
    const timer = window.setInterval(() => void syncAllAccounts(true), backgroundSettings.intervalMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [accounts, backgroundSettings, vaultPassword]);

  if (loadError) {
    return <main className="grid min-h-svh place-items-center p-6 text-sm text-destructive">{loadError}</main>;
  }

  if (!accounts) {
    return <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">Загружаем настройки…</main>;
  }

  if (accounts.length === 0 || isAddingAccount) {
    return (
      <AccountSetup
        isAdditional={accounts.length > 0}
        onCancel={accounts.length > 0 ? () => setAddingAccount(false) : undefined}
        onGmailConnected={async (account) => {
          setAccounts((current) => [...(current ?? []), account]);
          setActiveAccountId(account.id);
          setActiveFolder("INBOX");
          setAddingAccount(false);
          try {
            const status = await syncAccount(account.id, "");
            setSyncMessage(`Синхронизировано: папок — ${status.mailboxCount}, писем — ${status.messageCount}`);
            setSyncRevision((current) => current + 1);
          } catch (reason) {
            setSyncMessage(reason instanceof Error ? reason.message : String(reason || "Gmail подключён, но первая синхронизация не удалась"));
          }
        }}
        onAccountCreated={async (account, password, newVaultPassword) => {
          setVaultPassword(newVaultPassword);
          setAccounts((current) => [...(current ?? []), account]);
          setActiveAccountId(account.id);
          setActiveFolder("INBOX");
          setAddingAccount(false);

          try {
            const status = await syncAccount(account.id, password);
            setSyncMessage(`Синхронизировано: папок — ${status.mailboxCount}, писем — ${status.messageCount}`);
            setSyncRevision((current) => current + 1);
          } catch {
            setSyncMessage("Аккаунт сохранён, но первая синхронизация не удалась");
          }
        }}
      />
    );
  }

  const accountList = accounts;

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = accounts?.find((item) => item.authType === "password");
    if (!account) {
      return;
    }
    setUnlockError(null);

    try {
      const password = await readCredential(account.id, "imapPassword", unlockPassword);
      if (!password) {
        throw new Error("Данные для входа не найдены в хранилище.");
      }
      setVaultPassword(unlockPassword);
      void saveStoredVaultPassword(unlockPassword).catch(() => undefined);
      setUnlockPassword("");
    } catch {
      setUnlockError("Не удалось открыть хранилище. Проверьте пароль.");
    }
  }

  async function downloadAttachment(position: number, name: string) {
    const message = selectedMessage;
    const account = message ? accountList.find((item) => item.id === message.accountId) : null;
    if (!account || !message || (account.authType !== "gmail_oauth" && !vaultPassword)) {
      return;
    }

    setAttachmentMessage(null);
    const destination = await save({ defaultPath: attachmentFileName(name) });
    if (!destination) {
      return;
    }

    setSavingAttachmentPosition(position);
    try {
      const password = await accountCredential(account, "imapPassword");
      await saveMessageAttachment(account.id, message.mailboxPath, message.uid, position, password, destination);
      setAttachmentMessage(`Вложение «${name}» сохранено.`);
    } catch (reason) {
      setAttachmentMessage(reason instanceof Error ? reason.message : "Не удалось сохранить вложение.");
    } finally {
      setSavingAttachmentPosition(null);
    }
  }

  function openCompose() {
    setCompose(emptyCompose);
    setDraftId(null);
    setComposeMessage(null);
    setComposeAccountId(activeAccountId ?? accountList[0]?.id ?? null);
    setComposeOpen(true);
  }

  async function saveComposeDraft(): Promise<Draft> {
    const account = accountList.find((item) => item.id === composeAccountId);
    if (!account) {
      throw new Error("Аккаунт не найден.");
    }

    const draft = await saveDraft({ ...compose, accountId: account.id, id: draftId });
    setDraftId(draft.id);
    return draft;
  }

  async function handleSaveDraft() {
    setComposeMessage(null);
    setSavingDraft(true);
    try {
      await saveComposeDraft();
      setComposeMessage("Черновик сохранён на этом устройстве.");
    } catch (reason) {
      setComposeMessage(reason instanceof Error ? reason.message : "Не удалось сохранить черновик.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = accountList.find((item) => item.id === composeAccountId);
    if (!account || (account.authType !== "gmail_oauth" && !vaultPassword)) {
      setComposeMessage("Откройте хранилище, чтобы отправить письмо.");
      return;
    }

    setComposeMessage(null);
    setSending(true);
    try {
      const draft = await saveComposeDraft();
      const password = await accountCredential(account, "smtpPassword");
      await sendMessage(account.id, password, compose);
      await deleteDraft(draft.id);
      setComposeOpen(false);
      setCompose(emptyCompose);
      setDraftId(null);
      setSyncMessage("Письмо отправлено через SMTP");
    } catch (reason) {
      setComposeMessage(reason instanceof Error ? reason.message : "Не удалось отправить письмо.");
    } finally {
      setSending(false);
    }
  }

  async function syncAllAccounts(isBackground = false) {
    if (isSyncing) {
      return;
    }

    setSyncing(true);
    const results = await Promise.allSettled(accountList.map(async (account) => {
      const password = await accountCredential(account, "imapPassword");
      return syncAccount(account.id, password);
    }));
    const successful = results.filter((result) => result.status === "fulfilled");
    const messageCount = successful.reduce(
      (count, result) => count + result.value.messageCount,
      0,
    );
    setSyncRevision((current) => current + 1);
    const inbox = await listUnifiedInbox();
    const currentKeys = new Set(inbox.map(messageKey));
    const newMessageCount = [...currentKeys].filter((key) => !knownMessageKeys.current.has(key)).length;
    knownMessageKeys.current = currentKeys;
    if (isBackground && hasCompletedBackgroundSync.current && successful.length && backgroundSettings.notifications && newMessageCount) {
      const granted = await isPermissionGranted() || await requestPermission() === "granted";
      if (granted) sendNotification({ title: "RMail", body: `Новых писем: ${newMessageCount}.` });
    }
    hasCompletedBackgroundSync.current = true;
    setSyncMessage(
      successful.length === accountList.length
        ? `Синхронизировано ящиков: ${successful.length}, писем: ${messageCount}`
        : `Синхронизировано ящиков: ${successful.length} из ${accountList.length}`,
    );
    setSyncing(false);
  }

  if (activeView === "settings") {
    return (
      <SettingsPage
        accounts={accountList}
        backgroundSettings={backgroundSettings}
        onAccountUpdated={(updated) => setAccounts((current) => current?.map((account) => account.id === updated.id ? updated : account) ?? [])}
        onAddAccount={() => setAddingAccount(true)}
        onBack={() => setActiveView("mail")}
        onBackgroundSettingsChange={setBackgroundSettings}
        vaultPassword={vaultPassword}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={350}>
      <main className="min-h-svh bg-background text-foreground">
        <ResizablePanelGroup className="min-h-svh" orientation="horizontal">
          <ResizablePanel defaultSize="19%" minSize="16%">
            <aside className="flex h-full min-w-52 flex-col border-r bg-sidebar px-3 py-4">
              <div className="flex items-center justify-between px-2">
                <button className="flex items-center gap-2 rounded-md p-1 text-sm font-semibold" type="button">
                  <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
                    R
                  </span>
                  RMail
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
                <IconButton label="Добавить аккаунт" onClick={() => setAddingAccount(true)}>
                  <Plus />
                </IconButton>
              </div>

              <Button className="mt-6 w-full justify-start" onClick={openCompose}>
                <PenLine />
                Написать
              </Button>

              <Button className="mt-2 w-full" disabled={isSyncing} onClick={() => void syncAllAccounts()} size="sm" variant="secondary">
                {isSyncing ? "Синхронизация…" : "Синхронизировать всё"}
              </Button>

              {!vaultPassword && accountList.some((account) => account.authType === "password") ? (
                <form className="mt-3 space-y-2 rounded-lg border bg-background/70 p-3" onSubmit={unlockVault}>
                  <p className="text-xs leading-5 text-muted-foreground">Откройте хранилище один раз, чтобы сохранить ключ в системе.</p>
                  <label className="setup-field">
                    <span className="sr-only">Пароль хранилища</span>
                    <input onChange={(event) => setUnlockPassword(event.target.value)} placeholder="Пароль хранилища" required type="password" value={unlockPassword} />
                  </label>
                  {unlockError ? <p className="text-xs text-destructive" role="alert">{unlockError}</p> : null}
                  <Button className="w-full" size="sm" type="submit">Открыть хранилище</Button>
                </form>
              ) : null}

              <nav aria-label="Почтовые папки" className="mt-6 space-y-1">
                <button
                  aria-current={activeAccountId === null ? "page" : undefined}
                  className="folder-link"
                  data-active={activeAccountId === null}
                  onClick={() => setActiveAccountId(null)}
                  type="button"
                >
                  <Inbox className="size-4" />
                  <span>Все входящие</span>
                </button>
                <p className="px-2 pt-4 text-xs font-medium text-muted-foreground">Аккаунты</p>
                {accountList.map((account) => (
                  <button
                    className="folder-link"
                    data-active={activeAccountId === account.id}
                    key={account.id}
                    onClick={() => {
                      setActiveAccountId(account.id);
                      setActiveFolder("INBOX");
                    }}
                    type="button"
                  >
                    <span className="truncate">{account.displayName}</span>
                  </button>
                ))}
                {activeAccountId === null ? null : mailboxes.map((mailbox) => (
                  <button
                    aria-current={activeFolder === mailbox.path ? "page" : undefined}
                    className="folder-link"
                    data-active={activeFolder === mailbox.path}
                    key={`${activeAccountId}:${mailbox.path}`}
                    onClick={() => setActiveFolder(mailbox.path)}
                    type="button"
                  >
                    <Inbox className="size-4" />
                    <span>{folderLabel(mailbox.path)}</span>
                    {mailbox.unreadCount ? <span className="ml-auto text-xs tabular-nums">{mailbox.unreadCount}</span> : null}
                  </button>
                ))}
              </nav>

              <Button className="mt-4 w-full justify-start" onClick={() => setActiveView("settings")} variant="ghost">
                <Settings />
                Настройки
              </Button>

              <div className="mt-auto rounded-lg border bg-background/70 p-3 text-xs text-muted-foreground">
                <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  {syncMessage.startsWith("Синхронизировано") ? "Синхронизация завершена" : "Синхронизация ожидает"}
                </div>
                {syncMessage}
              </div>
            </aside>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize="34%" minSize="26%">
            <section className="flex h-full min-w-72 flex-col border-r">
              <header className="border-b px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{activeAccountId === null ? "Общий ящик" : accountList.find((account) => account.id === activeAccountId)?.displayName}</p>
                    <h1 className="mt-0.5 text-lg font-semibold">{activeAccountId === null ? "Все входящие" : folderLabel(activeFolder)}</h1>
                  </div>
                  <IconButton label="Дополнительные действия">
                    <MoreHorizontal />
                  </IconButton>
                </div>
                <label className="search-field mt-4">
                  <Search className="size-4" />
                  <span className="sr-only">Поиск писем</span>
                  <input
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Поиск"
                    type="search"
                    value={query}
                  />
                </label>
              </header>

              <ScrollArea className="min-h-0 flex-1">
                <div className="p-2">
                  {visibleMessages.length ? (
                    visibleMessages.map((message) => (
                      <button
                        className="message-row"
                        data-selected={selectedMessageKey === messageKey(message)}
                        key={messageKey(message)}
                        onClick={() => {
                          setSelectedMessageKey(messageKey(message));
                          setContentMode("text");
                        }}
                        type="button"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-1 size-2 shrink-0 rounded-full bg-primary opacity-0 data-[unread=true]:opacity-100" data-unread={!message.isRead} />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-3">
                              <p className="truncate text-sm font-medium">{message.sender}</p>
                              <time className="ml-auto text-xs text-muted-foreground">{message.date}</time>
                            </div>
                            <p className="mt-1 truncate text-sm" data-unread={!message.isRead}>{message.subject}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{message.accountDisplayName} · {folderLabel(message.mailboxPath)}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="grid min-h-48 place-items-center px-8 text-center text-sm text-muted-foreground">
                      {query ? "Ничего не найдено. Попробуйте другой запрос." : "В этой папке пока нет синхронизированных писем."}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </section>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize="47%" minSize="32%">
            <article className="flex h-full min-w-80 flex-col">
              <header className="flex items-center justify-between border-b px-6 py-4">
                <div className="flex gap-1">
                  <IconButton label="Архивировать"><Archive /></IconButton>
                  <IconButton label="Удалить"><Trash2 /></IconButton>
                  <IconButton label="Отложить"><Clock3 /></IconButton>
                </div>
                <IconButton label="Ещё"><MoreHorizontal /></IconButton>
              </header>

              <ScrollArea className="min-h-0 flex-1">
                {selectedMessage ? (
                  <div className="mx-auto max-w-3xl px-8 py-9">
                    <div className="flex items-start gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
                      {selectedMessage.sender[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-3">
                        <div>
                          <h2 className="text-xl font-semibold tracking-tight">{selectedMessage.subject}</h2>
                          <p className="mt-2 text-sm font-medium">{selectedMessage.sender}</p>
                          <p className="text-sm text-muted-foreground">{selectedMessage.accountDisplayName} · {folderLabel(selectedMessage.mailboxPath)}</p>
                        </div>
                        <time className="ml-auto shrink-0 text-xs text-muted-foreground">{selectedMessage.date}</time>
                      </div>

                      {!vaultPassword && accountList.find((account) => account.id === selectedMessage.accountId)?.authType === "password" ? (
                        <form className="mt-8 max-w-sm space-y-3" onSubmit={unlockVault}>
                          <p className="text-sm leading-6 text-muted-foreground">Откройте хранилище, чтобы загрузить текст письма.</p>
                          <label className="setup-field">
                            <span>Пароль хранилища</span>
                            <input onChange={(event) => setUnlockPassword(event.target.value)} required type="password" value={unlockPassword} />
                          </label>
                          {unlockError ? <p className="text-sm text-destructive" role="alert">{unlockError}</p> : null}
                          <Button type="submit">Открыть хранилище</Button>
                        </form>
                      ) : (
                        <>
                          {messageBody?.html ? (
                            <div className="mt-8 flex gap-2">
                              <Button onClick={() => setContentMode("text")} size="sm" type="button" variant={contentMode === "text" ? "secondary" : "ghost"}>Текст</Button>
                              <Button onClick={() => setContentMode("html")} size="sm" type="button" variant={contentMode === "html" ? "secondary" : "ghost"}>HTML</Button>
                            </div>
                          ) : null}
                          {contentMode === "html" && messageBody?.html ? (
                            <iframe
                              className="mt-5 min-h-96 w-full rounded-lg border bg-background"
                              referrerPolicy="no-referrer"
                              sandbox=""
                              srcDoc={messageBody.html}
                              title="HTML-версия письма"
                            />
                          ) : (
                            <div className="mail-body mt-8 whitespace-pre-wrap break-words text-[0.95rem] leading-7 text-foreground/85">
                              {isBodyLoading ? "Загружаем текст письма…" : bodyError ?? messageBody?.text ?? "Текст письма недоступен."}
                            </div>
                          )}
                          {messageBody?.attachments.length ? (
                            <div className="mt-8 space-y-3">
                              <div className="flex flex-wrap gap-2">
                              {messageBody.attachments.map((attachment) => (
                                <Button
                                  className="attachment-chip"
                                  disabled={savingAttachmentPosition !== null}
                                  key={`${attachment.position}-${attachment.name}`}
                                  onClick={() => void downloadAttachment(attachment.position, attachment.name)}
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                >
                                  <Paperclip className="size-3.5" />
                                  {savingAttachmentPosition === attachment.position ? "Сохраняем…" : `${attachment.name} · ${attachment.mimeType}`}
                                </Button>
                              ))}
                              </div>
                              {attachmentMessage ? <p className="text-sm text-muted-foreground" role="status">{attachmentMessage}</p> : null}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  </div>
                ) : (
                  <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
                    Выберите письмо, чтобы посмотреть его заголовок.
                  </div>
                )}
              </ScrollArea>
            </article>
          </ResizablePanel>
        </ResizablePanelGroup>

        {isComposeOpen ? (
          <form aria-label="Новое письмо" className="compose-window" onSubmit={handleSendMessage}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-medium">Новое письмо</span>
              <Button onClick={() => setComposeOpen(false)} size="icon-xs" type="button" variant="ghost">×</Button>
            </div>
            <label className="compose-field">
              <span>От кого</span>
              <select onChange={(event) => setComposeAccountId(Number(event.target.value))} value={composeAccountId ?? ""}>
                {accountList.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.email}</option>)}
              </select>
            </label>
            <label className="compose-field"><span>Кому</span><input autoFocus onChange={(event) => setCompose((current) => ({ ...current, recipients: event.target.value }))} placeholder="name@company.com, colleague@company.com" value={compose.recipients} /></label>
            <label className="compose-field"><span>Тема</span><input onChange={(event) => setCompose((current) => ({ ...current, subject: event.target.value }))} placeholder="Тема" value={compose.subject} /></label>
            <textarea aria-label="Текст письма" className="min-h-36 flex-1 resize-none p-4 outline-none" onChange={(event) => setCompose((current) => ({ ...current, body: event.target.value }))} placeholder="Напишите сообщение…" value={compose.body} />
            {composeMessage ? <p className="px-4 text-sm text-muted-foreground" role="status">{composeMessage}</p> : null}
            <div className="flex items-center justify-between border-t p-3">
              <div className="flex gap-2">
                <Button disabled={isSending} type="submit">{isSending ? "Отправляем…" : "Отправить"}</Button>
                <Button disabled={isSavingDraft || isSending} onClick={() => void handleSaveDraft()} type="button" variant="secondary">{isSavingDraft ? "Сохраняем…" : "Сохранить черновик"}</Button>
              </div>
              <span className="text-xs text-muted-foreground">Без вложений</span>
            </div>
          </form>
        ) : null}
      </main>
    </TooltipProvider>
  );
}

export default App;

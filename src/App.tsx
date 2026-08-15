import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Archive, ChevronDown, Clock3, Inbox, MoreHorizontal, Paperclip, PenLine, Search, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  deleteAccount,
  listAccounts,
  listCachedMailboxes,
  listCachedMessages,
  loadMessageBody,
  syncAccount,
  testMailConnection,
  type Account,
  type CachedMailbox,
  type CachedMessage,
  type CreateAccountInput,
  type MessageBody,
} from "@/lib/accounts";
import { readCredential, saveCredentials } from "@/lib/credentials";
import "./App.css";

function folderLabel(path: string) {
  return path.toUpperCase() === "INBOX" ? "Входящие" : path;
}

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

function AccountSetup({ onAccountCreated }: { onAccountCreated: (account: Account, password: string, vaultPassword: string) => Promise<void> }) {
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
  const [isTesting, setTesting] = useState(false);
  const [isConnectionVerified, setConnectionVerified] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  function updateField(field: keyof CreateAccountInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setConnectionVerified(false);
    setConnectionMessage(null);
  }

  async function testConnection() {
    setError(null);
    setConnectionMessage(null);
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
      setError(reason instanceof Error ? reason.message : "Unable to test the connection.");
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

    if (vaultPassword !== vaultPasswordConfirmation) {
      setError("Пароли хранилища не совпадают.");
      return;
    }

    setSubmitting(true);

    try {
      const account = await createAccount(input);

      try {
        await saveCredentials(account.id, connectionPassword, vaultPassword);
      } catch {
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
        <p className="mt-7 text-sm font-medium text-primary">Первый аккаунт</p>
        <h1 id="setup-title" className="mt-1 text-2xl font-semibold tracking-tight">Подключите почту</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Проверьте доступ к IMAP и SMTP, затем защитите данные для входа паролем хранилища.
        </p>

        <form className="mt-7 space-y-4" onSubmit={submit}>
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
            <span>Пароль хранилища</span>
            <input
              onChange={(event) => setVaultPassword(event.target.value)}
              required
              type="password"
              value={vaultPassword}
            />
            <small>Не менее 12 символов. Его нельзя восстановить.</small>
          </label>
          <label className="setup-field">
            <span>Повторите пароль хранилища</span>
            <input
              onChange={(event) => setVaultPasswordConfirmation(event.target.value)}
              required
              type="password"
              value={vaultPasswordConfirmation}
            />
          </label>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <Button className="mt-2 w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Сохраняем…" : "Продолжить"}
          </Button>
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
  const [activeFolder, setActiveFolder] = useState("INBOX");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [isComposeOpen, setComposeOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState("Откройте хранилище, чтобы синхронизировать почту");
  const [syncRevision, setSyncRevision] = useState(0);
  const [vaultPassword, setVaultPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState<MessageBody | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [isBodyLoading, setBodyLoading] = useState(false);
  const [contentMode, setContentMode] = useState<"text" | "html">("text");

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

  const selectedMessage =
    cachedMessages.find((message) => message.uid === selectedId) ?? null;

  useEffect(() => {
    void listAccounts()
      .then(setAccounts)
      .catch((reason) => setLoadError(reason instanceof Error ? reason.message : "Unable to load accounts."));
  }, []);

  useEffect(() => {
    const account = accounts?.[0];
    if (!account) {
      return;
    }

    void listCachedMailboxes(account.id)
      .then((items) => {
        setMailboxes(items);
        setActiveFolder((current) => items.some((mailbox) => mailbox.path === current) ? current : (items[0]?.path ?? "INBOX"));
      })
      .catch(() => setSyncMessage("Не удалось загрузить локальный кеш"));
  }, [accounts, syncRevision]);

  useEffect(() => {
    const account = accounts?.[0];
    if (!account) {
      return;
    }

    void listCachedMessages(account.id, activeFolder)
      .then((items) => {
        setCachedMessages(items);
        setSelectedId(items[0]?.uid ?? null);
        setContentMode("text");
      })
      .catch(() => setSyncMessage("Не удалось загрузить письма из кеша"));
  }, [accounts, activeFolder, syncRevision]);

  useEffect(() => {
    const account = accounts?.[0];
    const message = cachedMessages.find((item) => item.uid === selectedId);
    if (!account || !message || !vaultPassword) {
      setMessageBody(null);
      return;
    }

    setBodyLoading(true);
    setBodyError(null);
    void readCredential(account.id, "imapPassword", vaultPassword)
      .then((password) => {
        if (!password) {
          throw new Error("Данные для входа не найдены в хранилище.");
        }

        return loadMessageBody(account.id, activeFolder, message.uid, password);
      })
      .then(setMessageBody)
      .catch((reason) => setBodyError(reason instanceof Error ? reason.message : "Не удалось загрузить письмо."))
      .finally(() => setBodyLoading(false));
  }, [accounts, activeFolder, cachedMessages, selectedId, vaultPassword]);

  if (loadError) {
    return <main className="grid min-h-svh place-items-center p-6 text-sm text-destructive">{loadError}</main>;
  }

  if (!accounts) {
    return <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">Загружаем настройки…</main>;
  }

  if (accounts.length === 0) {
    return (
      <AccountSetup
        onAccountCreated={async (account, password, newVaultPassword) => {
          setVaultPassword(newVaultPassword);
          setAccounts([account]);

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

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = accounts?.[0];
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
      setUnlockPassword("");
    } catch {
      setUnlockError("Не удалось открыть хранилище. Проверьте пароль.");
    }
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
                <IconButton label="Настройки">
                  <Settings2 />
                </IconButton>
              </div>

              <Button className="mt-6 w-full justify-start" onClick={() => setComposeOpen(true)}>
                <PenLine />
                Написать
              </Button>

              <nav aria-label="Почтовые папки" className="mt-6 space-y-1">
                {mailboxes.map((mailbox) => (
                  <button
                    aria-current={activeFolder === mailbox.path ? "page" : undefined}
                    className="folder-link"
                    data-active={activeFolder === mailbox.path}
                    key={mailbox.path}
                    onClick={() => setActiveFolder(mailbox.path)}
                    type="button"
                  >
                    <Inbox className="size-4" />
                    <span>{folderLabel(mailbox.path)}</span>
                    {mailbox.unreadCount ? <span className="ml-auto text-xs tabular-nums">{mailbox.unreadCount}</span> : null}
                  </button>
                ))}
              </nav>

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
                    <p className="text-xs font-medium text-muted-foreground">Основной ящик</p>
                    <h1 className="mt-0.5 text-lg font-semibold">{folderLabel(activeFolder)}</h1>
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
                        data-selected={selectedId === message.uid}
                        key={message.uid}
                        onClick={() => {
                          setSelectedId(message.uid);
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
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">Синхронизированный заголовок</p>
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
                          <p className="text-sm text-muted-foreground">Письмо из INBOX</p>
                        </div>
                        <time className="ml-auto shrink-0 text-xs text-muted-foreground">{selectedMessage.date}</time>
                      </div>

                      {!vaultPassword ? (
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
                            <div className="mt-8 flex flex-wrap gap-2">
                              {messageBody.attachments.map((attachment) => (
                                <span className="attachment-chip" key={`${attachment.name}-${attachment.size}`}>
                                  <Paperclip className="size-3.5" />
                                  {attachment.name} · {attachment.mimeType}
                                </span>
                              ))}
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
          <section aria-label="Новое письмо" className="compose-window">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-medium">Новое письмо</span>
              <Button onClick={() => setComposeOpen(false)} size="icon-xs" variant="ghost">×</Button>
            </div>
            <label className="compose-field"><span>Кому</span><input autoFocus placeholder="Получатель" type="email" /></label>
            <label className="compose-field"><span>Тема</span><input placeholder="Тема письма" /></label>
            <textarea aria-label="Текст письма" className="min-h-36 flex-1 resize-none p-4 outline-none" placeholder="Напишите сообщение…" />
            <div className="flex items-center justify-between border-t p-3">
              <Button onClick={() => setComposeOpen(false)}>Отправить</Button>
              <IconButton label="Прикрепить файл"><Paperclip /></IconButton>
            </div>
          </section>
        ) : null}
      </main>
    </TooltipProvider>
  );
}

export default App;

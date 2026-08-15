import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Archive,
  ChevronDown,
  Clock3,
  Inbox,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Search,
  Send,
  Settings2,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
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
  listAccounts,
  testMailConnection,
  type Account,
  type CreateAccountInput,
} from "@/lib/accounts";
import "./App.css";

type Folder = "Входящие" | "Отправленные" | "Черновики" | "В архиве" | "Корзина";

type Message = {
  id: string;
  sender: string;
  address: string;
  subject: string;
  preview: string;
  body: string;
  time: string;
  unread?: boolean;
  starred?: boolean;
  attachments?: string[];
};

const folders: { name: Folder; icon: LucideIcon; count?: number }[] = [
  { name: "Входящие", icon: Inbox, count: 7 },
  { name: "Отправленные", icon: Send },
  { name: "Черновики", icon: PenLine, count: 2 },
  { name: "В архиве", icon: Archive },
  { name: "Корзина", icon: Trash2 },
];

const messages: Message[] = [
  {
    id: "design",
    sender: "Анна Соколова",
    address: "anna@northstar.studio",
    subject: "Макеты для релиза",
    preview: "Обновила экраны и оставила несколько вопросов по пустым состояниям.",
    body: "Привет!\n\nОбновила основные экраны для первого релиза и добавила состояния пустого ящика. Посмотри, пожалуйста, комментарии в макете — особенно сценарий первого подключения аккаунта.\n\nЕсли всё выглядит хорошо, передам в разработку завтра утром.",
    time: "10:42",
    unread: true,
    starred: true,
    attachments: ["rmail-release.fig", "notes.pdf"],
  },
  {
    id: "deploy",
    sender: "Dev Team",
    address: "dev@rmail.app",
    subject: "Деплой запланирован на пятницу",
    preview: "Подтвердили окно обслуживания: 18:00–18:30 UTC.",
    body: "Команда,\n\nПодтвердили окно обслуживания: пятница, 18:00–18:30 UTC. В этот период приложение может быть недоступно несколько минут.\n\nСпасибо!",
    time: "09:18",
    unread: true,
  },
  {
    id: "invoice",
    sender: "Мария Климова",
    address: "maria@studio.local",
    subject: "Счёт за август",
    preview: "Прикладываю счёт и акт. Дай знать, если нужны правки.",
    body: "Добрый день!\n\nПрикладываю счёт и акт за август. Если нужны правки по реквизитам или описанию работ, напиши — оперативно поправлю.\n\nМария",
    time: "Вчера",
    attachments: ["invoice-august.pdf"],
  },
  {
    id: "research",
    sender: "Алексей Воронцов",
    address: "alexey@product.team",
    subject: "Исследование почтовых сценариев",
    preview: "Собрал заметки по triage, поиску и работе офлайн.",
    body: "Привет!\n\nСобрал заметки по основным сценариям: triage, поиск и работа в офлайне. Предлагаю обсудить приоритеты на планировании.\n\nАлексей",
    time: "Вт",
  },
];

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

function AccountSetup({ onAccountCreated }: { onAccountCreated: (account: Account) => void }) {
  const [input, setInput] = useState<CreateAccountInput>({
    displayName: "",
    email: "",
    imapHost: "",
    smtpHost: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [connectionPassword, setConnectionPassword] = useState("");
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

    setSubmitting(true);

    try {
      onAccountCreated(await createAccount(input));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm" aria-labelledby="setup-title">
        <span className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">R</span>
        <p className="mt-7 text-sm font-medium text-primary">Первый аккаунт</p>
        <h1 id="setup-title" className="mt-1 text-2xl font-semibold tracking-tight">Подключите почту</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Проверьте доступ к IMAP и SMTP. Пароль используется только для проверки и пока не сохраняется.
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
  const [activeFolder, setActiveFolder] = useState<Folder>("Входящие");
  const [selectedId, setSelectedId] = useState(messages[0].id);
  const [query, setQuery] = useState("");
  const [isComposeOpen, setComposeOpen] = useState(false);

  const visibleMessages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return messages;
    }

    return messages.filter((message) =>
      [message.sender, message.subject, message.preview]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query]);

  const selectedMessage =
    messages.find((message) => message.id === selectedId) ?? messages[0];

  useEffect(() => {
    void listAccounts()
      .then(setAccounts)
      .catch((reason) => setLoadError(reason instanceof Error ? reason.message : "Unable to load accounts."));
  }, []);

  if (loadError) {
    return <main className="grid min-h-svh place-items-center p-6 text-sm text-destructive">{loadError}</main>;
  }

  if (!accounts) {
    return <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">Загружаем настройки…</main>;
  }

  if (accounts.length === 0) {
    return <AccountSetup onAccountCreated={(account) => setAccounts([account])} />;
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
                {folders.map(({ count, icon: Icon, name }) => (
                  <button
                    aria-current={activeFolder === name ? "page" : undefined}
                    className="folder-link"
                    data-active={activeFolder === name}
                    key={name}
                    onClick={() => setActiveFolder(name)}
                    type="button"
                  >
                    <Icon className="size-4" />
                    <span>{name}</span>
                    {count ? <span className="ml-auto text-xs tabular-nums">{count}</span> : null}
                  </button>
                ))}
              </nav>

              <div className="mt-auto rounded-lg border bg-background/70 p-3 text-xs text-muted-foreground">
                <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  Синхронизация готова
                </div>
                Обновлено только что
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
                    <h1 className="mt-0.5 text-lg font-semibold">{activeFolder}</h1>
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
                        data-selected={selectedId === message.id}
                        key={message.id}
                        onClick={() => setSelectedId(message.id)}
                        type="button"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-1 size-2 shrink-0 rounded-full bg-primary opacity-0 data-[unread=true]:opacity-100" data-unread={message.unread} />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-3">
                              <p className="truncate text-sm font-medium">{message.sender}</p>
                              <time className="ml-auto text-xs text-muted-foreground">{message.time}</time>
                            </div>
                            <p className="mt-1 truncate text-sm" data-unread={message.unread}>{message.subject}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{message.preview}</p>
                          </div>
                          {message.starred ? <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" /> : null}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="grid min-h-48 place-items-center px-8 text-center text-sm text-muted-foreground">
                      Ничего не найдено. Попробуйте другой запрос.
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
                          <p className="text-sm text-muted-foreground">{selectedMessage.address} · мне</p>
                        </div>
                        <time className="ml-auto shrink-0 text-xs text-muted-foreground">{selectedMessage.time}</time>
                      </div>

                      <div className="mail-body mt-8 whitespace-pre-line text-[0.95rem] leading-7 text-foreground/85">
                        {selectedMessage.body}
                      </div>

                      {selectedMessage.attachments ? (
                        <div className="mt-8 flex flex-wrap gap-2">
                          {selectedMessage.attachments.map((attachment) => (
                            <button className="attachment-chip" key={attachment} type="button">
                              <Paperclip className="size-3.5" />
                              {attachment}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-10 flex gap-2 border-t pt-6">
                        <Button>Ответить</Button>
                        <Button variant="outline">Переслать</Button>
                      </div>
                    </div>
                  </div>
                </div>
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

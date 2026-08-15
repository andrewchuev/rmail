function errorText(reason: unknown) {
  if (typeof reason === "string") {
    return reason;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  if (reason && typeof reason === "object" && "message" in reason && typeof reason.message === "string") {
    return reason.message;
  }
  return "";
}

export function connectionErrorMessage(reason: unknown) {
  const message = errorText(reason);
  const messages: Record<string, string> = {
    "input:Enter valid IMAP and SMTP server addresses.": "Проверьте адреса IMAP- и SMTP-серверов: укажите только имя хоста, без https:// и пути.",
    "input:Enter an email address and password.": "Введите адрес электронной почты и пароль почты.",
    "imap:IMAP server is unavailable.": "Не удалось подключиться к IMAP-серверу. Проверьте адрес, порт 993 и доступность сети.",
    "imap:Unable to establish a secure IMAP connection.": "IMAP-сервер не подтвердил защищённое TLS-подключение. Проверьте адрес сервера и его сертификат.",
    "imap:IMAP server did not respond.": "IMAP-сервер не ответил вовремя. Проверьте сеть или попробуйте позже.",
    "imap:IMAP server closed the connection.": "IMAP-сервер закрыл соединение. Проверьте параметры подключения и повторите попытку.",
    "imap:Unable to authenticate with IMAP.": "IMAP-сервер не принял учётные данные. Проверьте адрес почты и пароль.",
    "imap:Unable to list IMAP mailboxes.": "Подключение к IMAP установлено, но список папок недоступен. Проверьте права аккаунта.",
    "smtp:Invalid SMTP server address.": "Проверьте адрес SMTP-сервера.",
    "smtp:Unable to validate SMTP connection.": "Не удалось установить SMTP STARTTLS-подключение или пройти аутентификацию. Проверьте адрес, порт 587 и пароль.",
  };

  return messages[message] ?? "Не удалось проверить подключение. Проверьте параметры и повторите попытку.";
}

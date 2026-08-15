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
    "input:Enter valid IMAP and SMTP server addresses.": "Enter IMAP and SMTP host names without a protocol or path.",
    "input:Enter an email address and password.": "Enter an email address and email password.",
    "imap:IMAP server is unavailable.": "Unable to connect to the IMAP server. Check the host, port 993, and network connection.",
    "imap:Unable to establish a secure IMAP connection.": "The IMAP server did not establish a secure TLS connection. Check the server address and certificate.",
    "imap:IMAP server did not respond.": "The IMAP server did not respond in time. Check the network or try again later.",
    "imap:IMAP server closed the connection.": "The IMAP server closed the connection. Check the connection settings and try again.",
    "imap:Unable to authenticate with IMAP.": "The IMAP server rejected the credentials. Check the email address and password.",
    "imap:Unable to list IMAP mailboxes.": "The IMAP connection succeeded, but the mailbox list is unavailable. Check the account permissions.",
    "smtp:Invalid SMTP server address.": "Enter a valid SMTP server address.",
    "smtp:Unable to validate SMTP connection.": "Unable to establish SMTP STARTTLS or authenticate. Check the host, port 587, and password.",
  };

  return messages[message] ?? "Unable to verify the connection. Check the settings and try again.";
}

# RMail

Легковесный desktop-клиент электронной почты на Rust, Tauri 2 и React.

## Статус

Создан базовый Tauri-проект и рабочий UI-каркас на mock-данных. Объём первой версии описан в [docs/mvp.md](docs/mvp.md).

## Стек

- Rust + Tauri 2
- React 19 + TypeScript 7 + Vite
- shadcn/ui + Tailwind CSS

## Реализовано

- Трёхпанельный интерфейс: папки, список писем и чтение сообщения.
- Изменяемая ширина панелей и доступные tooltip-действия.
- Поиск по локальным mock-письмам, выбор письма и окно создания письма.
- Единые theme tokens, light-first дизайн и базовые пустые состояния.
- Onboarding первого аккаунта с локальным хранением метаданных в SQLite.
- Tauri-команды для создания и списка аккаунтов, покрытые unit-тестом.

## Данные и безопасность

SQLite хранит только название аккаунта, адрес и IMAP/SMTP-хосты. Формы credentials будут добавлены вместе с IMAP/SMTP-подключением; пароль или OAuth-токен не попадёт в SQLite или логи и будет сразу передан в защищённое хранилище.

Tauri Stronghold подготовлен для credentials: vault защищается Argon2-ключом, а salt и зашифрованный vault находятся в app data. Доступ к плагину ограничен явной capability `stronghold:default`.

### Linux build note

Stronghold использует `libsodium`. В `.cargo/config.toml` зафиксирован поддерживаемый флаг `SODIUM_DISABLE_PIE=1`, который предотвращает ошибку линковки SIMD-символов в WSLg/Linux-среде.

## Разработка

Требуются актуальные Node.js и Rust.

```bash
npm install
npm run tauri dev
```

Проверки перед изменениями:

```bash
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Принципы

- Быстрый запуск и локальный кеш.
- Минимальный, доступный desktop-интерфейс.
- Секреты не попадают в логи или локальную базу данных.

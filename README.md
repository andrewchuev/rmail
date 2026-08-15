# RMail

Легковесный desktop-клиент электронной почты на Rust, Tauri 2 и React.

## Статус

Создан базовый Tauri-проект и React frontend. Объём первой версии описан в [docs/mvp.md](docs/mvp.md).

## Стек

- Rust + Tauri 2
- React 19 + TypeScript 7 + Vite
- shadcn/ui + Tailwind CSS

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

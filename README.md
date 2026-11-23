# Notes RinRin

Личный минимальный PDF-блокнот: открыть PDF, читать вертикальной лентой, увеличивать жестом, рисовать чёрной ручкой и стирать свои штрихи.

- PDF и заметки хранятся локально в браузере через IndexedDB.
- Файлы пользователя не отправляются в GitHub.
- PDF рендерится через Mozilla PDF.js.

## GitHub Pages

Repository → Settings → Pages → Deploy from a branch → `main` / `/ (root)`.

## Cloud.ru (предварительная реализация)

В ветке `feature/cloudru-storage` подготовлены `Dockerfile`, серверный API и ручная синхронизация PDF/заметок с приватным бакетом Object Storage. Старый режим IndexedDB остаётся доступен. Для настройки и ограничений см. [пошаговое руководство](docs/cloudru-setup.md).

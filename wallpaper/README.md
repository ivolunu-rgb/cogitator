# Cogitator wallpaper

Живые обои для Windows на основе [Cogitator](https://github.com/asadovkamran/cogitator): консоль Адептус Механикус прямо на рабочем столе, с настоящими показателями ПК, новостями, каруселью артов и необязательным «стражем», который замечает подозрительную активность.

*A Windows live-wallpaper build of Cogitator: real PC vitals, CORRUPTION driven by load, news feeds, art carousel, an admin page and an optional security sentinel. Everything outside this folder is the original project by its author.*

## Что внутри

| Путь | Что это |
| --- | --- |
| `server.js` | локальный сервер на `127.0.0.1:8484`: отдаёт страницу обоев и арты, показатели ПК, события, новости, админку; поднимает Ollama, если она упала |
| `telemetry.ps1` | фоновый помощник сервера: игры, флешки, простой, интернет |
| `start-server.vbs` | запуск сервера без окна (для автозагрузки) |
| `news.json` | ленты новостей и частота; удобнее править через админку |
| `www/` | страница обоев (`app.html`) и админка (`admin.html`) |
| `lively/` | то, что кладётся в библиотеку Lively: загрузчик, `LivelyInfo.json`, миниатюра |
| `art/` | ваши картинки для карусели (в репозитории пусто) |
| `sentinel/` | страж ORDO SENTINEL: сам скрипт, установщик и удаление |

## Установка

Пути в коде рассчитаны на клон в `C:\cogitator`. В другой папке поправьте пути в `start-server.vbs`, `lively/index.html` и `sentinel/install-sentinel.ps1`.

1. Поставьте [Node.js](https://nodejs.org) 22+, [Ollama](https://ollama.com) и модель: `ollama pull qwen2.5:0.5b`.
2. Склонируйте репозиторий в `C:\cogitator`.
3. Положите арты в `wallpaper\art` (JPG, PNG, WebP, GIF). Официальные обои Games Workshop есть на [Warhammer Community](https://www.warhammer-community.com/en-gb/articles/omgjr6bi/warhammer-40000-and-warhammer-age-of-sigmar-wallpapers/); они для личного использования, в репозиторий их не кладём.
4. Автозапуск сервера: ярлык на `wscript.exe "C:\cogitator\wallpaper\start-server.vbs"` в папке «Автозагрузка» (Win+R → `shell:startup`). Запустите его один раз и сейчас.
5. Поставьте [Lively Wallpaper](https://github.com/rocksdanister/lively): `winget install --id rocksdanister.LivelyWallpaper --source winget`.
6. Скопируйте содержимое `wallpaper\lively` в `%LOCALAPPDATA%\Lively Wallpaper\Library\wallpapers\cogitator` и включите обои:
   `"C:\Program Files\Lively Wallpaper\Lively.exe" setwp --file "%LOCALAPPDATA%\Lively Wallpaper\Library\wallpapers\cogitator"`
7. Админка: http://127.0.0.1:8484/admin — арты, темы новостей, частота.

### Страж (по желанию, нужны права администратора)

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoExit -ExecutionPolicy Bypass -File C:\cogitator\wallpaper\sentinel\install-sentinel.ps1'
```

Установщик копирует скрипт в `C:\ProgramData\CogitatorSentinel` (писать туда может только администратор), включает журнал отбитых брандмауэром пакетов и аудит неудачных входов и регистрирует задачу от имени SYSTEM. Первые 3 дня страж учится, что для машины нормально. Удаление: `uninstall-sentinel.ps1` в той же папке. Это сигнализация с эвристикой, а не антивирус.

## Безопасность

- Сервер слушает только `127.0.0.1`: из сети он недоступен.
- Изменения (вердикты стража, загрузка артов, настройки новостей) принимаются только со своих страниц: проверяются заголовки `Host` и `Origin`.
- Страница обоев берётся с `http://127.0.0.1:8484`, поэтому Ollama не нужно разрешать запросы с `Origin: null`.

Warhammer 40,000 — торговая марка Games Workshop. Любительский проект для личного использования.

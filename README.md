# ВХолодильнике — Совместный редактор питча

## Быстрая публикация на GitHub Pages

1. Загрузите все файлы (включая скрытую папку `.github/workflows/deploy.yml` и `.gitignore`) в ветку `main`.
2. Откройте в репозитории **Settings → Pages → Build and deployment → Source** и выберите **GitHub Actions**.
3. После сборки сайт откроется по адресу `https://<username>.github.io/<repo>/?room=vholodilnike`.
4. Для входа через Google (облако Firestore 24/7) добавьте `<username>.github.io` в Authorized Domains в настройках Firebase Authentication.

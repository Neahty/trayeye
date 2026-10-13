# Веб-платформа TrayEye

Кабинеты директора школы и комбината питания. React 18 + Vite, без сторонних UI-библиотек.
Сейчас экраны без дизайна: только данные и действия. Дизайн - по макету Figma.

```bash
npm install
npm run dev      # http://localhost:5173, API проксируется на :4100
npm test         # vitest
npm run build    # web/dist, его раздаёт server/
```

| Путь | Экран |
| --- | --- |
| `/l/:token` | вход по личной ссылке |
| `/director` | главная: списания, экономия, дети, прогноз, рекомендации |
| `/director/menu` | меню на день, «Добавить меню», фото подноса |
| `/director/classes` | классы и посещаемость |
| `/director/stats` | статистика по дням и блюдам |
| `/kombinat` | сводка по всем школам |
| `/kombinat/schools` | школы, ссылки для директоров |
| `/kombinat/stats` | «Меню товаров» и статистика |
| `/kombinat/suppliers` | поставщики и каталог блюд |

Фото блюд в `public/dishes/` - временные, с Wikimedia Commons (авторы и лицензии в `public/dishes/CREDITS.md`).

// Дописывает разрешения в манифест Android-проекта.
// Расширение .cjs не случайно: пакет объявлен как ES-модуль ("type": "module"),
// а скрипту удобнее обычный require.
//
// Плагин камеры Capacitor свои разрешения НЕ объявляет - это остаётся на
// приложении. Без них съёмка и выбор из галереи молча падают на телефоне,
// а проект android/ генерируется заново при каждой сборке, поэтому правку
// нельзя просто закоммитить - её надо накладывать в CI.
const fs = require("fs");
const path = require("path");

const MANIFEST = path.resolve(__dirname, "../android/app/src/main/AndroidManifest.xml");

const PERMISSIONS = [
  // Съёмка еды
  ['android.permission.CAMERA', ""],
  // Выбор готового снимка: Android 13+ и более старые версии называют это по-разному
  ['android.permission.READ_MEDIA_IMAGES', ""],
  ['android.permission.READ_EXTERNAL_STORAGE', ' android:maxSdkVersion="32"']
];

if (!fs.existsSync(MANIFEST)) {
  console.error(`Нет манифеста ${MANIFEST} - сначала npx cap add android`);
  process.exit(1);
}

let xml = fs.readFileSync(MANIFEST, "utf8");
const added = [];

for (const [name, attrs] of PERMISSIONS) {
  if (xml.includes(name)) continue;
  xml = xml.replace(
    "</manifest>",
    `    <uses-permission android:name="${name}"${attrs} />\n</manifest>`
  );
  added.push(name);
}

if (added.length) {
  fs.writeFileSync(MANIFEST, xml);
  console.log("Добавлены разрешения:\n  " + added.join("\n  "));
} else {
  console.log("Все разрешения уже на месте");
}

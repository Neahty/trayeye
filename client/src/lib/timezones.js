// Часовые пояса для онбординга и профиля (СНГ + соседи).
export const TIMEZONES = [
  "Europe/Kaliningrad", "Europe/Moscow", "Europe/Samara", "Asia/Yekaterinburg",
  "Asia/Omsk", "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Yakutsk",
  "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka",
  "Europe/Minsk", "Europe/Kyiv", "Asia/Almaty", "Asia/Tashkent",
  "Asia/Tbilisi", "Asia/Baku", "Asia/Yerevan"
];

export const DEFAULT_TZ = "Europe/Moscow";

// Часовой пояс устройства, если он есть в списке — иначе дефолтный.
export function detectTz() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONES.includes(tz) ? tz : DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

// «Moscow · GMT+3» — человекочитаемая подпись пояса.
export function tzLabel(tz) {
  try {
    const s = new Intl.DateTimeFormat("ru", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return `${tz.split("/")[1].replace("_", " ")} · ${s || ""}`;
  } catch {
    return tz;
  }
}

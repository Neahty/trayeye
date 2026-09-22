// Приём пищи по умолчанию исходя из времени суток.
// Используется и при добавлении текстом, и при фото с камеры, чтобы записи
// раскладывались по завтрак/обед/ужин, а не сваливались все в «Перекусы».
// Час берём в поясе из профиля (tz): пояс устройства/webview может отличаться,
// и тогда обед уезжал в «Завтрак». Без tz или при ошибке Intl - часы устройства.
export function defaultMeal(tz) {
  let h;
  if (tz) {
    try {
      h = Number(new Intl.DateTimeFormat("ru", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
    } catch { h = undefined; }
  }
  if (!Number.isFinite(h)) h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

// Группирует сканы в «приёмы пищи»: все блюда одного фото/текста (общий batch_id)
// схлопываются в одну карточку. Фолбэк для старых записей без batch_id:
// фото-блюда склеиваются по photo_path, текст/ручные - по типу+времени.
// Возвращает массив групп с суммой КБЖУ и списком блюд (dishes).
export function groupScans(scans) {
  const groups = [];
  const byKey = new Map();
  for (const s of scans || []) {
    const key = s.batch_id
      || (s.photo_path ? `p:${s.photo_path}` : `t:${s.meal_type}|${s.time_label || s.scanned_at}`);
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        photo_path: s.photo_path || null,
        meal_type: s.meal_type,
        time_label: s.time_label || null,
        scanned_at: s.scanned_at,
        source: s.source,
        dishes: [],
        calories: 0, protein: 0, fat: 0, carbs: 0
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.dishes.push(s);
    g.calories += s.calories || 0;
    g.protein += Number(s.protein) || 0;
    g.fat += Number(s.fat) || 0;
    g.carbs += Number(s.carbs) || 0;
    // Берём самое раннее время приёма как время группы.
    if (new Date(s.scanned_at) < new Date(g.scanned_at)) {
      g.scanned_at = s.scanned_at;
      g.time_label = s.time_label || g.time_label;
    }
  }
  return groups;
}

// Короткое название приёма из его блюд: «Борщ» или «Борщ +2».
export function groupTitle(group) {
  const ds = group?.dishes || [];
  if (!ds.length) return "Приём пищи";
  return ds.length === 1 ? ds[0].dish_name : `${ds[0].dish_name} +${ds.length - 1}`;
}

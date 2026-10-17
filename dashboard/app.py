import os
from datetime import time

import requests
import streamlit as st

API = os.getenv("TRAYEYE_API_URL", "http://127.0.0.1:8000").rstrip("/")
st.set_page_config(page_title="TrayEye · Контроль пищевых отходов", page_icon="🍽️", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
:root { color-scheme: light; }
.stApp, [data-testid="stAppViewContainer"] { background: #f4f7f5; color: #172b25; }
[data-testid="stHeader"] { background: rgba(244,247,245,.96); }
[data-testid="stSidebar"] { background: #142f27; border-right: 1px solid #21483b; }
[data-testid="stSidebar"] * { color: #f4faf6 !important; }
[data-testid="stSidebar"] [data-testid="stRadio"] label { background: transparent; border-radius: 8px; padding: .35rem .5rem; }
h1,h2,h3,h4,p,label,span,div { }
h1 { color: #153b2e !important; font-weight: 750 !important; letter-spacing: -.035em; }
h2,h3,h4 { color: #1e4637 !important; font-weight: 700 !important; }
p, label, .stMarkdown, [data-testid="stCaptionContainer"] { color: #354b42; }
[data-testid="stMetric"] { background: #fff; border: 1px solid #dce7e0; border-radius: 14px; padding: 18px 20px; box-shadow: 0 2px 8px rgba(20,47,39,.035); }
[data-testid="stMetricLabel"] { color: #52675d !important; }
[data-testid="stMetricValue"] { color: #173c2e !important; }
div.stButton > button, div.stFormSubmitButton > button { background: #17734e; color: #fff; border: 1px solid #17734e; border-radius: 9px; font-weight: 650; min-height: 2.6rem; }
div.stButton > button:hover, div.stFormSubmitButton > button:hover { background: #10583b; color: #fff; border-color: #10583b; }
div[data-baseweb="select"] > div, div[data-baseweb="input"] > div, textarea { background: #fff !important; border-color: #cbd9d1 !important; }
[data-testid="stDataFrame"], [data-testid="stExpander"] { background: #fff; border: 1px solid #dce7e0; border-radius: 12px; }
[data-testid="stFileUploader"] { background: #fff; border: 1px dashed #a9c4b4; border-radius: 12px; padding: 12px; }
.trayeye-eyebrow { color:#17734e; font-size:.78rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; margin-bottom:.35rem; }
.trayeye-subtitle { color:#607268; font-size:1rem; margin-top:-.65rem; margin-bottom:1.3rem; }
.trayeye-panel { background:#fff; border:1px solid #dce7e0; border-radius:14px; padding:18px 20px; margin-bottom:12px; }
.trayeye-pill { display:inline-block; background:#e0f2e8; color:#176342; border-radius:999px; padding:5px 10px; font-size:.78rem; font-weight:700; }
</style>
""", unsafe_allow_html=True)


def api(method, path, *, show_error=True, **kwargs):
    try:
        response = requests.request(method, f"{API}{path}", timeout=12, **kwargs)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        if show_error:
            st.error(f"Не удалось связаться с сервером API. Возможно, сервис просыпается после простоя или завершился с ошибкой. Адрес: {API}. Подробности: {exc}")
        return None


def page_header(eyebrow, title, subtitle):
    st.markdown(f'<div class="trayeye-eyebrow">{eyebrow}</div>', unsafe_allow_html=True)
    st.title(title)
    st.markdown(f'<div class="trayeye-subtitle">{subtitle}</div>', unsafe_allow_html=True)


st.sidebar.markdown("# 🍽️ TrayEye")
st.sidebar.caption("Умный контроль пищевых отходов")
st.sidebar.markdown("---")
page = st.sidebar.radio("НАВИГАЦИЯ", ["Обзор", "Камера и распознавание", "Меню", "Проверка событий", "Настройки"], label_visibility="visible")
st.sidebar.markdown("---")
st.sidebar.markdown('<span class="trayeye-pill">ДЕМО-ПЛАТФОРМА</span>', unsafe_allow_html=True)
st.sidebar.caption("Результаты распознавания требуют проверки человеком.")

if page == "Обзор":
    page_header("Мониторинг столовой", "Обзор", "Сводка по меню, проверкам и состоянию системы.")
    health = api("GET", "/health", show_error=False)
    schedule = api("GET", "/api/schedule", show_error=False)
    menu = api("GET", "/api/menu", show_error=False)
    events = api("GET", "/api/events", show_error=False)
    connected = health is not None
    if connected:
        st.success("API доступен")
    else:
        st.warning(f"API пока недоступен ({API}). Данные не загрузились. Проверьте сервис trayeye-api в Render → Logs.")
    a, b, c, d = st.columns(4)
    a.metric("События проверки", len(events or []))
    b.metric("Блюда в меню", len(menu or []))
    c.metric("Приём пищи", (schedule or {}).get("current_meal", "—"))
    d.metric("Состояние API", "В сети" if connected else "Нет связи")
    st.markdown("### Последние события")
    if events:
        st.dataframe(events[:8], use_container_width=True, hide_index=True)
    else:
        st.info("Пока нет событий для отображения. Когда API заработает, новые проверки появятся здесь.")
    st.markdown("### Быстрые действия")
    left, right = st.columns(2)
    with left:
        st.markdown('<div class="trayeye-panel"><h4>📷 Камера и распознавание</h4><p>Загрузите фотографию подноса и отправьте её на анализ.</p></div>', unsafe_allow_html=True)
        if st.button("Открыть распознавание", use_container_width=True):
            st.session_state["trayeye_page"] = "Камера и распознавание"
            st.rerun()
    with right:
        st.markdown('<div class="trayeye-panel"><h4>🥗 Меню столовой</h4><p>Управляйте блюдами, которые подаются на завтрак и обед.</p></div>', unsafe_allow_html=True)
        if st.button("Открыть меню", use_container_width=True):
            st.session_state["trayeye_page"] = "Меню"
            st.rerun()
    st.caption("Важно: обученные веса модели не включены в репозиторий. Пока модель не подключена, система не должна считаться автоматическим распознавателем.")

elif page == "Камера и распознавание":
    page_header("Компьютерное зрение", "Камера и анализ подноса", "Загрузите изображение для отправки в сервис распознавания.")
    st.info("Модель распознавания должна быть обучена и подключена отдельно. Если весов модели нет, результат будет помечен как требующий проверки.")
    uploaded = st.file_uploader("Выберите фотографию подноса", type=["jpg", "jpeg", "png", "webp"])
    if uploaded:
        col1, col2 = st.columns([1.25, 1])
        with col1:
            st.image(uploaded, caption="Изображение для проверки", use_container_width=True)
        with col2:
            sched = api("GET", "/api/schedule", show_error=False) or {}
            st.markdown('<div class="trayeye-panel">', unsafe_allow_html=True)
            st.markdown("#### Детали проверки")
            st.write("Текущий приём пищи:", sched.get("current_meal", "Не определён"))
            st.write("Файл:", uploaded.name)
            st.write("Размер:", f"{uploaded.size / 1024:.0f} КБ")
            if st.button("Отправить на анализ", type="primary", use_container_width=True):
                result = api("POST", "/api/infer", files={"file": (uploaded.name, uploaded.getvalue(), uploaded.type)})
                if result:
                    inference = result.get("inference", {})
                    st.warning(inference.get("message", "Результат требует ручной проверки."))
                    st.json(result.get("event", result))
                    st.caption("Если сервер создал событие, оно появится в очереди проверки.")
            st.markdown("</div>", unsafe_allow_html=True)
    else:
        st.markdown('<div class="trayeye-panel"><h4>Как это работает</h4><p>1. Выберите фото подноса.</p><p>2. Отправьте файл на API.</p><p>3. Проверьте результат в очереди событий.</p></div>', unsafe_allow_html=True)
        st.caption("Потоковая камера в реальном времени пока не подключена; сейчас доступна загрузка снимка.")

elif page == "Меню":
    page_header("Питание", "Меню столовой", "Список блюд для выбранных приёмов пищи.")
    items = api("GET", "/api/menu") or []
    if items:
        st.dataframe(items, use_container_width=True, hide_index=True)
    else:
        st.info("Меню пока пусто или API недоступен.")
    st.markdown("### Добавить блюдо")
    with st.form("add_menu"):
        meal = st.selectbox("Приём пищи", ["Завтрак", "Обед"])
        name = st.text_input("Название блюда", placeholder="Например, овощной салат")
        category = st.selectbox("Категория", ["рыба", "мясо", "овощи", "гарнир", "суп", "фрукты", "другое"])
        submitted = st.form_submit_button("Добавить блюдо", type="primary")
        if submitted:
            if not name.strip():
                st.error("Введите название блюда.")
            elif api("POST", "/api/menu", json={"meal": meal, "name": name.strip(), "category": category}):
                st.success("Блюдо добавлено.")
                st.rerun()
    if items:
        st.markdown("### Удалить блюдо")
        chosen = st.selectbox("Позиция меню", items, format_func=lambda x: f'{x["name"]} · {x["meal"]}')
        if st.button("Удалить выбранное"):
            result = api("DELETE", f'/api/menu/{chosen["id"]}')
            if result is not None:
                st.success("Позиция удалена.")
                st.rerun()

elif page == "Проверка событий":
    page_header("Контроль качества", "Очередь проверки", "Просматривайте результаты и подтверждайте или исправляйте решения модели.")
    status_filter = st.selectbox("Статус события", ["Все", "review", "approved", "corrected", "dismissed"])
    kwargs = {} if status_filter == "Все" else {"params": {"status": status_filter}}
    events = api("GET", "/api/events", **kwargs) or []
    if not events:
        st.info("Событий для отображения нет либо API временно недоступен.")
    for event in events:
        with st.expander(f'Событие #{event["id"]} · {event["meal"]} · {event["created_at"]} · {event["status"]}', expanded=event["status"] == "review"):
            st.write("Обнаруженные продукты:", ", ".join(event.get("items") or []) or "Не определены")
            st.write(event.get("note", ""))
            with st.form(f'review_{event["id"]}'):
                choices = ["review", "approved", "corrected", "dismissed"]
                status = st.selectbox("Решение", choices, index=choices.index(event["status"]))
                items_text = st.text_input("Продукты через запятую", value=", ".join(event.get("items") or []))
                note = st.text_input("Комментарий", value=event.get("note", ""))
                if st.form_submit_button("Сохранить решение", type="primary"):
                    payload = {"status": status, "items": [x.strip() for x in items_text.split(",") if x.strip()], "note": note}
                    if api("PATCH", f'/api/events/{event["id"]}', json=payload):
                        st.success("Изменения сохранены.")
                        st.rerun()

elif page == "Настройки":
    page_header("Конфигурация", "Настройки системы", "Настройте расписание и проверьте адрес API.")
    sched = api("GET", "/api/schedule") or {"breakfast_start": "08:00", "lunch_start": "12:00"}
    st.markdown("### Расписание столовой")
    with st.form("schedule"):
        breakfast = st.time_input("Начало завтрака", value=time.fromisoformat(sched["breakfast_start"]))
        lunch = st.time_input("Начало обеда", value=time.fromisoformat(sched["lunch_start"]))
        if st.form_submit_button("Сохранить расписание", type="primary"):
            if breakfast >= lunch:
                st.error("Начало завтрака должно быть раньше начала обеда.")
            else:
                result = api("PUT", "/api/schedule", json={"breakfast_start": breakfast.strftime("%H:%M"), "lunch_start": lunch.strftime("%H:%M")})
                if result:
                    st.success(f'Расписание сохранено. Сейчас: {result["current_meal"]}.')
    st.markdown("### Подключение сервера")
    st.code(API, language=None)
    st.caption("Если здесь указан неверный адрес, обновите переменную TRAYEYE_API_URL в настройках сервиса dashboard в Render.")
    st.caption("Telegram-уведомления ещё не реализованы. Для постоянного хранения данных и реального использования в школе понадобится база данных и настройка доступа.")

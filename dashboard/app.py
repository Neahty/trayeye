import os
from datetime import time
import requests
import streamlit as st

API = os.getenv("TRAYEYE_API_URL", "http://127.0.0.1:8000").rstrip("/")
st.set_page_config(page_title="TrayEye", page_icon="🍽️", layout="wide")
st.markdown("""
<style>
.stApp { background: #f5f9f7; }
[data-testid="stSidebar"] { background: #e7f5ec; }
h1,h2,h3 { color: #1769AA; }
div.stButton > button[kind="primary"] { background:#16834A; border-color:#16834A; }
</style>
""", unsafe_allow_html=True)

def api(method, path, **kwargs):
    try:
        response = requests.request(method, f"{API}{path}", timeout=5, **kwargs)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        st.error(f"Не удалось связаться с API ({API}). Запустите сервер. Детали: {exc}")
        return None

st.sidebar.markdown("# 🍽️ TrayEye")
st.sidebar.caption("Умный контроль пищевых отходов")
page = st.sidebar.radio("Раздел", ["Обзор", "Камера и распознавание", "Меню", "Проверка событий", "Настройки"])
st.sidebar.caption("Зелёный · белый · синий")

if page == "Обзор":
    st.title("Панель мониторинга")
    st.write("Сводка столовой и состояние системы")
    health, schedule, menu, events = api("GET", "/health"), api("GET", "/api/schedule"), api("GET", "/api/menu"), api("GET", "/api/events")
    a,b,c = st.columns(3)
    a.metric("Событий", len(events or []))
    b.metric("Позиций меню", len(menu or []))
    c.metric("Сейчас", (schedule or {}).get("current_meal", "—"))
    if health:
        st.warning("Демо-режим: API работает, но обученная модель распознавания еды ещё не подключена.")
    st.subheader("Последние события")
    if events: st.dataframe(events[:8], use_container_width=True, hide_index=True)
    st.info("Сомнительные результаты необходимо проверять вручную.")

elif page == "Камера и распознавание":
    st.title("Камера и анализ тарелки")
    st.write("Загрузите кадр с камеры или тестовое изображение. Модель пока не подключена, поэтому сервер не придумывает предсказания.")
    uploaded = st.file_uploader("Изображение тарелки", type=["jpg","jpeg","png","webp"])
    if uploaded:
        col1,col2 = st.columns([1.2,1])
        with col1: st.image(uploaded, caption="Входное изображение", use_container_width=True)
        with col2:
            sched = api("GET", "/api/schedule") or {}
            st.metric("Период", sched.get("current_meal","—"))
            if st.button("Отправить на анализ", type="primary"):
                result = api("POST","/api/infer",files={"file":(uploaded.name,uploaded.getvalue(),uploaded.type)})
                if result:
                    st.warning(result["inference"]["message"])
                    st.json(result["event"])
                    st.caption("Событие добавлено в очередь проверки.")
    else: st.info("Пока доступна загрузка кадров; потоковую камеру нужно подключить отдельным worker-процессом.")

elif page == "Меню":
    st.title("Меню столовой")
    items = api("GET","/api/menu") or []
    if items: st.dataframe(items, use_container_width=True, hide_index=True)
    st.subheader("Добавить блюдо")
    with st.form("add_menu"):
        meal = st.selectbox("Приём пищи",["Завтрак","Обед"])
        name = st.text_input("Название блюда",placeholder="Например, овощной салат")
        category = st.selectbox("Категория",["рыба","мясо","овощи","гарнир","суп","фрукты","другое"])
        submitted = st.form_submit_button("Добавить блюдо",type="primary")
        if submitted:
            if not name.strip(): st.error("Введите название блюда.")
            elif api("POST","/api/menu",json={"meal":meal,"name":name.strip(),"category":category}):
                st.success("Блюдо добавлено."); st.rerun()
    if items:
        st.subheader("Удалить блюдо")
        chosen = st.selectbox("Позиция",items,format_func=lambda x:f'{x["name"]} · {x["meal"]}')
        if st.button("Удалить выбранное"):
            if api("DELETE",f'/api/menu/{chosen["id"]}') is not None:
                st.success("Позиция удалена."); st.rerun()

elif page == "Проверка событий":
    st.title("Очередь проверки")
    status_filter = st.selectbox("Фильтр",["Все","review","approved","corrected","dismissed"])
    kwargs = {} if status_filter == "Все" else {"params":{"status":status_filter}}
    events = api("GET","/api/events",**kwargs) or []
    if not events: st.success("Событий для отображения нет.")
    for event in events:
        with st.expander(f'#{event["id"]} · {event["meal"]} · {event["created_at"]} · {event["status"]}',expanded=event["status"]=="review"):
            st.write("Продукты:",", ".join(event.get("items") or []) or "Не определены")
            st.write(event.get("note",""))
            with st.form(f'review_{event["id"]}'):
                choices = ["review","approved","corrected","dismissed"]
                status = st.selectbox("Решение",choices,index=choices.index(event["status"]))
                items_text = st.text_input("Продукты через запятую",value=", ".join(event.get("items") or []))
                note = st.text_input("Комментарий",value=event.get("note",""))
                if st.form_submit_button("Сохранить решение",type="primary"):
                    payload={"status":status,"items":[x.strip() for x in items_text.split(",") if x.strip()],"note":note}
                    if api("PATCH",f'/api/events/{event["id"]}',json=payload):
                        st.success("Сохранено."); st.rerun()

elif page == "Настройки":
    st.title("Расписание и система")
    sched = api("GET","/api/schedule") or {"breakfast_start":"08:00","lunch_start":"12:00"}
    st.caption("Расписание применяется сервером. В production задайте часовой пояс явно.")
    with st.form("schedule"):
        breakfast = st.time_input("Начало завтрака",value=time.fromisoformat(sched["breakfast_start"]))
        lunch = st.time_input("Начало обеда",value=time.fromisoformat(sched["lunch_start"]))
        if st.form_submit_button("Сохранить расписание",type="primary"):
            if breakfast >= lunch: st.error("Начало завтрака должно быть раньше начала обеда.")
            else:
                result=api("PUT","/api/schedule",json={"breakfast_start":breakfast.strftime("%H:%M"),"lunch_start":lunch.strftime("%H:%M")})
                if result: st.success(f'Расписание сохранено. Сейчас: {result["current_meal"]}.')
    st.subheader("Подключение")
    st.code(f"API: {API}")
    st.write("Переменные Telegram подготовлены в .env.example; отправитель уведомлений ещё нужно реализовать.")

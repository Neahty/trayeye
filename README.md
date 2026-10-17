# TrayEye — camera ML + cafeteria dashboard

TrayEye is a prototype for cafeteria tray-waste monitoring.

## Projects included
- `server/`: FastAPI backend for schedule, menu, review events, and image uploads.
- `dashboard/`: Streamlit web dashboard with image preview, menu editing, schedule controls, and manual review.
- `requirements.txt`, `Dockerfile`, `docker-compose.yml`: local setup and container deployment.

## Run locally
Python 3.11+ recommended.

```bash
pip install -r requirements.txt
uvicorn server.main:app --reload
```
In another terminal:
```bash
streamlit run dashboard/app.py
```
Dashboard: http://localhost:8501
API docs: http://localhost:8000/docs

## ML status — important
This repository includes an image-upload/inference API scaffold, **not a trained food recognition model**. Until a trained and evaluated detector/segmenter is added, uploaded images are queued for human review and no food labels are fabricated. To deliver real recognition, collect appropriately consented tray images, annotate food categories/remaining portions, train a detector or segmentation model, and evaluate on representative cafeteria footage.

Meal defaults: breakfast 08:00–12:00, lunch from 12:00 onward. Configure the host timezone for deployment.

## Before production
- Add authentication and role-based access for canteen staff and director.
- Replace in-memory demo data with PostgreSQL.
- Add audit logs, TLS, backups, retention controls and secret management.
- Implement a camera worker and Telegram sender.
- Avoid face recognition or identifying children from tray images; retain only necessary data.
- Require human review for uncertain or potentially misattributed events.

Never commit bot tokens or credentials. See `.env.example`.

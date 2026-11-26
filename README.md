# Drink-Buddy
This is an application that let's you connect with your drinking buddies to get to have fun.

```
drink-buddy/
├── backend/   main.py, requirements.txt, .env.example
├── web/       Vite + React + Tailwind v4 (src/App.jsx)
└── mobile/    Expo (App.jsx)
```

## 1. Backend (FastAPI)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                     # paste Daraja sandbox Consumer Key + Secret
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
Docs: http://localhost:8000/docs. On first start the app creates SQLite `drinkbuddy.db` and adds the 4 venues.

## 2. Web
```bash
cd web
npm install
npm run dev            # http://localhost:5173
```
To use a different API, run `VITE_API_URL=http://<host>:8000 npm run dev`.

## 3. Mobile (Expo)
```bash
npx create-expo-app@latest mobile --template blank
cd mobile
rm App.js                                  # replace with the provided App.jsx
npx expo install expo-constants
npx expo start                             # scan QR with Expo Go (same Wi-Fi)
```
The app finds your computer's LAN IP from Expo automatically (backend must run with `--host 0.0.0.0`).
To set it yourself, run `EXPO_PUBLIC_API_URL=http://192.168.x.x:8000 npx expo start`.

## Flow
Sign up (18+ and ODPC consent) → Join a squad (pending) → Pay via STK Push → callback or STK query confirms the payment → member **approved** → group chat unlocks.

## Endpoints
| Method | Path | Notes |
|---|---|---|
| POST | /auth/signup, /auth/login | Bearer token |
| GET | /me | |
| GET | /venues | includes `active_checkins` (`expires_at > now()` in SQL) |
| POST/GET/DELETE | /checkins, /checkins/me | 4-hour expiry; one active check-in per user |
| GET/POST | /squads | size 3–8 |
| GET | /squads/mine, /squads/{id} | members are visible only to approved members |
| POST | /squads/{id}/join | |
| GET/POST | /squads/{id}/messages?after_id= | approved members only (polling) |
| POST | /reports | safety report |
| POST | /mpesa/stkpush | `{squad_id, phone}` |
| POST | /mpesa/callback | Daraja webhook |
| GET | /mpesa/status/{checkout_request_id} | poll; falls back to STK Query |

Postgres: `pip install psycopg2-binary` and set `DATABASE_URL`.

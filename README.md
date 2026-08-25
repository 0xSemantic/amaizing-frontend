# Amaizing frontend

This is an independent Vite + React PWA. It has no backend templating.

1. Copy `.env.example` to `.env` and set `VITE_API_URL` to the deployed FastAPI URL.
2. Run `npm install` and `npm run build`.
3. Deploy the generated `dist/` directory to any HTTPS static host or web server.
4. Add the frontend origin to `AMAIZING_FRONTEND_ORIGINS` on the backend.

For local development:

```bash
npm install
cp .env.example .env
npm run dev
```

Then open `http://127.0.0.1:3000`. PWA installation requires HTTPS in production.

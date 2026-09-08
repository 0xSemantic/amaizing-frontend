# Amaizing frontend

This is an independent Vite + React PWA. It has no backend templating.

1. Copy `.env.example` to `.env` and set `VITE_API_URL` to the deployed FastAPI URL.
   `VITE_MAX_UPLOAD_MB` sets the upload ceiling (500 MB by default) and should match
   `AMAIZING_MAX_UPLOAD_MB` on the API.
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

## Image handling

Photos are resized in the browser before upload. Anything longer than 1600px on its
long edge, or larger than 2 MB, is redrawn to a canvas and re-encoded as JPEG at
quality 0.85; a typical 11 MB phone capture leaves the device at roughly 570 KB. The
model reads a 224px crop, so nothing that affects the diagnosis is lost, and the
upload stays quick on a weak mobile connection.

Smaller images are sent exactly as chosen, with their original format intact. If a
browser cannot decode the file, the original is uploaded unchanged rather than the
selection failing.

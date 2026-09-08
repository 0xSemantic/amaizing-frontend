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

## Leaf check

The model has four outputs (Blight, Common Rust, Gray Leaf Spot, Healthy) and no
"not a leaf" class, so it labels a photo of anything at all as one of the four with
high confidence. The frontend screens the photo first and warns before a request is
spent on an obviously wrong subject. The warning can be overridden with a tap, and
nothing is sent to the API unless the photo passes or the user overrides.

The check reads colour, contrast and texture from a 256px copy of the image. It tests
for what a leaf is never made of rather than testing for green, because blighted
leaves are tan, rust is orange-brown and gray leaf spot is grey; a green test would
pass healthy leaves and reject sick ones. Thresholds in `GATE` were calibrated against
4,940 real maize leaf images, the `dataset/` splits plus the PlantDoc field photos,
and trip on 1 of them (0.02%).

It reliably catches screenshots, documents, charts, sky, water, plain surfaces,
blank or unfocused frames and photos too dark to read. It does not catch subjects that
share a leaf's colouring and texture, such as bare soil, wood or skin; those reach the
model and get a meaningless label, which is the same behaviour as before the check
existed. Raising the ceiling further would start rejecting real diseased leaves, which
is the worse failure for anyone actually standing in a field.

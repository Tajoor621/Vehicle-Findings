# Vehicle Findings

[Open the free app](https://tajoor621.github.io/Vehicle-Findings/). Built for UAE and GCC used-car buyers. The public app runs on GitHub Pages without an account, backend, subscription, or API key.

- Check a 17-character VIN, its manufacturer identifier and its check digit. The check digit convention varies by market. The approximate VIN region and the decoded assembly country describe different things.
- See available specifications from NHTSA vPIC and US recall campaigns by make, model and year. Confirm whether a specific VIN is affected and whether the repair was completed with NHTSA or the manufacturer. Results can be incomplete for non-US vehicles.
- Switch between English and Arabic. Scan a VIN barcode when the browser supports camera access and BarcodeDetector. Read a plate photo with Tesseract.js in the browser, review the text, and move the VIN into the search field. The first read downloads OCR software and language data from public CDNs. The photo itself stays on the device. Camera and photo support vary by device.
- Save service, accident, inspection and mileage entries privately per VIN. Export a JSON backup before clearing browser data or moving devices. Import checks the VIN and skips duplicate entries.
- Open the official UAE Ministry of Interior accident inquiry. Accident, insurance, title, odometer and GCC-spec status require independent verification. A decode, an empty lookup, and owner-reported entries provide no official history clearance.

## Run locally

Use Node.js 22 or later. No dependencies to install.

```sh
npm test
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The local server exposes the same app and proxies public NHTSA data. It caches successful public lookups for up to 24 hours. Keep it on localhost for private workshop use. Its report and record read endpoints are public to anyone who can reach the server.

## Optional workshop API

```sh
cp .env.example .env
# Set a strong WRITE_TOKEN if you want server-side writes.
npm start
```

- `GET /api/health` checks the server.
- `GET /api/vin/:vin` returns available decoder data, recalls, workshop records and configured connector results.
- `GET /api/vin/:vin/records` lists locally stored workshop records.
- `POST /api/vin/:vin/records` requires a Bearer `WRITE_TOKEN` and JSON containing a type (service, accident, inspection, mileage), an ISO date, optional integer kilometres, note and source. For mileage entries, kilometres are required. A single server process owns the JSON store. Back up the file if you use it for workshop records.
- `POST /api/plate` is an optional hosted integration. It requires `ANTHROPIC_API_KEY`, `WRITE_TOKEN`, and either multipart field `image` or JSON with base64 `image` and `mediaType`. It sends the supplied photo to Anthropic. The free web interface uses the browser photo reader.
- Licensed history, accident and insurance connectors are optional. Configure them only when you have source access and intend to use any associated paid services.

For Docker, use `docker build -t vehicle-findings .` and `docker run --rm -p 127.0.0.1:3000:3000 --env-file .env -v vehicle-data:/app/data vehicle-findings`. The named volume persists workshop records.

## GitHub Pages

The repository root `index.html` is the entry point. The branch-based Pages configuration publishes from `main` and `/ (root)`. All runtime files are referenced relative to that entry point so the app works under `/Vehicle-Findings/`. The CI workflow runs the test suite on pushes and pull requests.

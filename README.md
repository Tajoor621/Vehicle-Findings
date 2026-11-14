# Gulf VIN Check

Vehicle history and component facts by VIN, built for UAE/GCC buyers (cars of any origin).
Zero dependencies: Node 20+ only.

## What works now
- VIN validation, approximate country of origin, check-digit test
- Specs and component facts (engine, transmission, drivetrain, brakes, safety) from the free NHTSA vPIC decoder
- Recalls by make/model/year from NHTSA
- Workshop/user service records stored locally (`POST /api/vin/:vin/records`)
- Optional paid history provider (accidents, salvage, odometer) via `HISTORY_API_URL`
- Spec-plate photo reading (`POST /api/plate`): extracts VIN, builder, production date, engine, transmission, colour/trim and the Arabic GCC-conformity statement; needs `ANTHROPIC_API_KEY`. The photo is sent to the Anthropic API and not stored.
- Insurance status and accident records through pluggable licensed connectors (`INSURANCE_API_URL`, `ACCIDENTS_API_URL`), merged with workshop/user-reported accidents. With no source connected the app says so and never implies a clean history.
- Bilingual UI (English/Arabic, RTL) and camera barcode scan where the browser supports it
- 24h cache and per-IP rate limit

NHTSA data is strongest for US-market vehicles. Japanese, European and GCC-spec cars often decode partially;
GCC-spec status is reported as `unknown` because it cannot be read from the VIN.

## Run
```bash
cp .env.example .env     # then export the variables, or set them inline
npm start
# or
node src/server.js
```

Open http://localhost:3000

## Docker
```bash
docker build -t gulf-vin-check .
docker run --rm -p 3000:3000 --env-file .env gulf-vin-check
```

## API (summary)
- `GET /api/vin/:vin` — full report
- `POST /api/vin/:vin/records` — add service record (Bearer `WRITE_TOKEN`)
- `POST /api/plate` — multipart image of the manufacturer plate

See source and tests for details.

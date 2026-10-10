# WorldViews

WorldViews brings open data and map information together in one world. You pick a question, such as "How tall is it?",
"Who lives here?" or "What is overhead?", and the map recolours to answer it, with a legend, a number and a source. It works
from the whole globe down to a street, without a GIS course. City builders such as Cities: Skylines and SimCity, with their
info views and data maps, are the reference for how a city answers one question at a time.

It is a static web app: TanStack Start (React) on Rsbuild, MapLibre GL, Base UI and Iconify. All data is fetched by the
browser from public, keyless sources. There is no server at runtime.

## Two editions

The same code builds two sites:

| Edition | Site | Data |
|---|---|---|
| WorldViews Libre (default) | `npm run build` into `dist-libre/client` | Open-licence and public-domain sources only. |
| WorldViews | `npm run build:full` into `dist-full/client` | Also sources whose licence is not open (noncommercial use with attribution). |

The edition is chosen at build time with `PUBLIC_EDITION=libre|full`. In the libre build every branch for a non-open source is
dead code, so neither that code nor its data URLs are in the libre bundle. A new source goes into the libre edition only if its
licence is open.

## Views and data sources

| View | Sources | Licence |
|---|---|---|
| How tall is it? | [AlreadyOpen world-buildings](https://huggingface.co/datasets/alreadyopen/world-buildings) (Overture Maps buildings as one tile set per region) and [AlreadyOpen hk-buildings](https://huggingface.co/datasets/alreadyopen/hk-buildings) (Lands Department via CSDI, for Hong Kong) | ODbL, © OpenStreetMap contributors; CSDI terms |
| What is happening now? | [USGS earthquakes](https://earthquake.usgs.gov/earthquakes/feed/), [GDACS](https://www.gdacs.org), [NASA EONET](https://eonet.gsfc.nasa.gov) | Public domain; GDACS terms; NASA open data |
| Where can I ride? (Hong Kong) | [AlreadyOpen hk-transit](https://huggingface.co/datasets/alreadyopen/hk-transit) (TD, KMB, Citybus, MTR) | Government of the HKSAR data (DATA.GOV.HK, CSDI terms) |
| Who lives here? | [World Bank indicators API](https://data.worldbank.org), [Natural Earth](https://www.naturalearthdata.com), [AlreadyOpen world-places](https://huggingface.co/datasets/alreadyopen/world-places) | CC BY 4.0; public domain; per source |
| How easy is business here? | [World Bank B-READY](https://www.worldbank.org/en/businessready) | CC BY 4.0 |
| What do building energy rules require? | [World Bank RISE](https://rise.esmap.org) via the Data360 API | CC BY 4.0 |
| What is overhead? | [CelesTrak](https://celestrak.org/NORAD/elements/) GP data (from the US Space Force's space-track.org), positions computed in the browser with [satellite.js](https://github.com/shashwatak/satellite-js) | CelesTrak usage policy (each group fetched at most every 2 hours); satellite.js MIT |
| Where can I fly from? | [OurAirports](https://ourairports.com/data/) via [AlreadyOpen world-airports](https://huggingface.co/datasets/alreadyopen/world-airports) | Public domain |
| How busy are the roads? (South Australia) | [SA DIT traffic volume estimates](https://data.sa.gov.au/data/dataset/e5d6588a-f163-4f6a-bc57-25e95c87b5bd) and [road crash locations](https://data.sa.gov.au/data/dataset/cf8d8549-b976-4523-88ad-46dd32053696) (zips read in the browser) | CC BY 4.0; crash file CC BY 3.0 AU |
| Basemap | [OpenFreeMap](https://openfreemap.org) | © OpenStreetMap contributors (ODbL) |

The full edition adds the World Bank's [Building Green](https://www.worldbank.org/en/building-green) dataset to the building
rules view, and AlreadyOpen's noncommercial places dataset to the people figures. Both are noncommercial use with attribution.

### Country layers (Australia, Taiwan, United States)

Read by the browser straight from each official source, only while their view is on and the map is over their area (big
services per grid cell in view). All are keyless, answer the browser (CORS) and carry an open licence, so both editions have
them. Code: `src/local-au.ts`, `src/local-tw.ts`, `src/local-us.ts` (shared helpers in `src/local-kit.ts`).

| Place | View | Source | Licence |
|---|---|---|---|
| Australia | What is happening now? | [Geoscience Australia earthquakes](https://earthquakes.ga.gov.au), [DEA Hotspots](https://hotspots.dea.ga.gov.au) (WFS by grid cell), [NSW RFS major incidents](https://www.rfs.nsw.gov.au/news-and-media/stay-up-to-date/feeds) | CC BY 4.0 |
| South Australia | What is happening now? (Roads) | [SA DIT Traffic SA](https://data.sa.gov.au/data/dataset/8d75dfcc-cc95-4be3-8747-ff273e8c53db) incidents, closures and detours, roadworks; [outback road warnings](https://data.sa.gov.au/data/dataset/f87c3fe7-e175-4538-a4cb-78521bc02eec) | CC BY 4.0 |
| Australia | Who lives here? | [ABS estimated resident population by SA2](https://www.abs.gov.au/statistics/people/population/regional-population) with age (Data API) on ASGS 2021 boundaries; SA [enrolments by school](https://data.sa.gov.au/data/dataset/d385385a-6d79-4ef7-ab0f-0cfc583469f6) | CC BY 4.0 |
| Melbourne | How tall is it? | [City of Melbourne 2023 building footprints](https://data.melbourne.vic.gov.au/explore/dataset/2023-building-footprints/) | CC BY 4.0 |
| Australia | City card | [AEMO NEM summary](https://visualisations.aemo.com.au): price and demand now in the NEM region at the map centre | AEMO copyright permissions (any purpose, with attribution) |
| Taiwan | What is happening now? | [CWA open data](https://opendata.cwa.gov.tw) (public S3 bucket): warnings by county, earthquake reports, weather stations | Open Government Data License 1.0 |
| Taiwan | Who lives here? | [MOI household registration](https://www.ris.gov.tw/app/portal/346) ODRP014 (single-year ages) and ODRP020 (education), by county | Open Government Data License 1.0 |

Each view shows its sources and licences in the app. "None" in a figure means the source does not publish one for that place.

## Run and build

Node 22 or newer.

```sh
npm ci
npm run dev            # libre edition, http://127.0.0.1:8760
npm run dev:full       # full edition, http://127.0.0.1:8761
npm run build          # libre static site in dist-libre/client
npm run build:full     # full static site in dist-full/client
```

Each output folder is a plain set of static files: serve it with any static server, for example
`python3 -m http.server -d dist-libre/client 8080`.

The URL holds the whole state, so a view can be shared: for example `?view=airports&at=hk`.

## Deploy to Cloudflare Pages

Wrangler is pinned in `devDependencies`. Log in once with `npx wrangler login`, then:

```sh
npm run build      && npx wrangler pages deploy dist-libre/client --project-name worldviews-libre
npm run build:full && npx wrangler pages deploy dist-full/client  --project-name worldviews
```

`npm run deploy` and `npm run deploy:full` run the same two steps. `public/_headers` gives the hashed files under `/assets/`
a long cache lifetime.

## Licence

Code: Apache-2.0 (see `LICENSE`). Data stays under each source's own licence, listed above.

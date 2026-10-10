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
| Basemap | [OpenFreeMap](https://openfreemap.org) | © OpenStreetMap contributors (ODbL) |

The full edition adds the World Bank's [Building Green](https://www.worldbank.org/en/building-green) dataset to the building
rules view, and AlreadyOpen's noncommercial places dataset to the people figures. Both are noncommercial use with attribution.

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

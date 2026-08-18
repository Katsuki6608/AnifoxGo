# Hoshi Anime Catalogue

Hoshi is a static, AniList-powered anime catalogue with three client-rendered routes:

- `/home`: spotlight, trending, latest, popular, and Top 10 sections
- `/details/{id}`: anime metadata, studio, characters, and Japanese voice actors
- `/watch/{id}`: editable season and episode directory

It is a catalogue and episode-listing interface only. It does not include a video player, iframe, embedded media, or streaming source code.

## Project Structure

```text
.
├── assets/
│   ├── css/
│   │   └── style.css         # All site styling
│   ├── images/               # Put local optional images here
│   └── js/
│       └── app.js            # AniList API, routes, search, and UI rendering
├── docker-compose.alloy.yaml # Docker development server
├── index.html                # Shared application shell
├── server.py                 # Static server with route fallback
└── README.md
```

## Run

```bash
docker compose -f docker-compose.alloy.yaml up -d
```

Open `http://localhost:3000/home`.

The `server.py` fallback makes `/home`, `/details/{id}`, and `/watch/{id}` resolve to the shared HTML shell. JavaScript then renders the matching page.

## Add Episode Links

In `assets/js/app.js`, edit `CATALOG_OVERRIDES` near the top of the file. AniList IDs are used as keys.

```js
window.CATALOG_OVERRIDES = {
  16498: {
    episodeLinks: {
      1: "https://your-domain.example/episode-1",
      2: "https://your-domain.example/episode-2"
    },
    seasonSize: 24
  }
};
```

Any episode without an override remains a simple `href="#"` link. This project never loads or embeds the URL.

## Override Anime Metadata

The same object can override a title or description while retaining AniList data for the rest of the page.

```js
window.CATALOG_OVERRIDES = {
  16498: {
    title: "My custom Attack on Titan title",
    description: "My custom catalogue description.",
    episodes: 25
  }
};
```

## AniList Data

`assets/js/app.js` calls the public AniList GraphQL endpoint for:

- homepage collections
- title, poster, banner, rating, genres, studio, and episode counts
- character names, portraits, and Japanese voice actors

No AniList access key is required.

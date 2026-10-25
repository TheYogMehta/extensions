# StrawVerse Extension Developer Guide

Welcome to the **StrawVerse Extension Development Guide**! StrawVerse features a decentralized, multi-repository extension architecture. Anyone can create, host, and maintain their own repository of extensions for Anime and Manga. Users can easily add your repository to StrawVerse by simply providing your GitHub repository URL.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Repository Layout](#2-repository-layout)
3. [The `marketplace.json` Manifest](#3-the-marketplacejson-manifest)
4. [Extension Directory Scoping](#4-extension-directory-scoping)
5. [Anime Extension Specification](#5-anime-extension-specification)
6. [Manga Extension Specification](#6-manga-extension-specification)
7. [Declarative Header & Stream Rules](#7-declarative-header--stream-rules)
8. [Cloudflare & Anti-Bot Bypass Rules](#8-cloudflare--anti-bot-bypass-rules)
9. [Metadata Mapping & Catalog Sync](#9-metadata-mapping--catalog-sync)
10. [Security Restrictions & Sandbox](#10-security-restrictions--sandbox)
11. [Publishing & Adding Your Repo to StrawVerse](#11-publishing--adding-your-repo-to-strawverse)

---

## 1. Architecture Overview

- **Decentralized:** Extensions are plain JavaScript modules hosted in public git repositories (e.g., on GitHub). StrawVerse fetches them directly without requiring centralized store approvals.
- **Client-Side:** Scrapers execute client-side inside StrawVerse, parsing HTML or JSON from public websites and streaming content directly to the user's video player or manga reader.
- **Scoped Namespace:** Extensions install into `/<Type>/<REPO_OWNER>/<EXTENSION>.js` (e.g. `/Anime/TheYogMehta/pahe.js` or `/Anime/communitydev/coolanime.js`).
  - **Community / Unofficial Extensions:** All community extensions are strictly scoped and registered as `@<REPO_OWNER>/<EXTENSION>` (e.g. `@communitydev/coolanime`). In databases, catalogs, and unmapped metadata reports, they are always referenced under `@<REPO_OWNER>/<EXTENSION>`.
  - **Official Extensions:** Only extensions maintained in the official repository (`TheYogMehta/extensions`) are exposed via bare top-level identifiers (e.g. `pahe`, `anikoto`).

---

## 2. Repository Layout

To host your own StrawVerse extensions repository on GitHub, create a repository with the following structure:

```
my-strawverse-extensions/
├── marketplace.json
├── extensions/
│   ├── Anime/
│   │   └── mysite.js
│   └── Manga/
│       └── mymanga.js
├── ico/
│   ├── mysite.ico
│   └── mymanga.ico
└── README.md
```

- `marketplace.json`: The catalog manifest listing all available extensions and versions in your repository.
- `extensions/Anime/`: JavaScript files for Anime scrapers.
- `extensions/Manga/`: JavaScript files for Manga scrapers.
- `ico/`: Favicon / icon files (`.ico` or `.png`) for each scraper (named `<scraper_name>.ico`).

---

## 3. The `marketplace.json` Manifest

Placed at the root of your repository, `marketplace.json` tells StrawVerse what extensions are available:

```json
{
  "Anime": [
    {
      "name": "mysite",
      "version": "1.0.0",
      "MinAppVersion": "11.0.0",
      "disabled": false
    }
  ],
  "Manga": [
    {
      "name": "mymanga",
      "version": "1.0.0",
      "MinAppVersion": "11.0.0",
      "disabled": false
    }
  ]
}
```

### Fields

| Field           | Type    | Required | Description                                                                                |
| --------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| `name`          | string  | Yes      | Internal identifier of the extension (must match the filename without `.js`).              |
| `version`       | string  | Yes      | Semver version (e.g., `"1.0.0"`). Increasing this prompts users with an **Update** button. |
| `MinAppVersion` | string  | No       | Minimum StrawVerse version supported (e.g., `"11.0.0"`).                                   |
| `disabled`      | boolean | No       | Set to `true` if the scraper is broken or undergoing maintenance.                          |

Icons are automatically resolved from your repository's `ico/` directory (e.g. `ico/<name>.ico`).

---

## 4. Extension Directory Scoping

When a user installs your extension, StrawVerse saves it into:

```
~/.config/strawverse/scrapers/Anime/<REPO_OWNER>/<EXTENSION>.js
~/.config/strawverse/scrapers/Manga/<REPO_OWNER>/<EXTENSION>.js
```

The scraper is registered in StrawVerse with the unique identifier `<REPO_OWNER>/<EXTENSION>` (for example `@TheYogMehta/pahe`). Users can select which provider they want in **Settings → Scraper Providers**.

---

## 5. Anime Extension Specification

An Anime extension module exports functions and configuration properties.

```javascript
// extensions/Anime/mysite.js
const cheerio = require("cheerio");
const axios = global.axios || require("axios");

const baseUrl = "https://mysite.to";

/**
 * Search for anime titles.
 * @param {string} query
 * @returns {Promise<Array<{ id: string, title: string, image: string }>>}
 */
async function SearchAnime(query) {
  const url = `${baseUrl}/search?keyword=${encodeURIComponent(query)}`;
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const results = [];

  $(".anime-card").each((_, el) => {
    results.push({
      id:
        $(el).attr("data-id") ||
        $(el).find("a").attr("href").replace("/anime/", ""),
      title: $(el).find(".title").text().trim(),
      image: $(el).find("img").attr("src"),
    });
  });

  return results;
}

/**
 * Fetch detailed anime metadata and episode list.
 * @param {string} id
 * @returns {Promise<{ id: string, title: string, image: string, description: string, episodes: Array<{ id: string, episode: number, title?: string }> }>}
 */
async function AnimeInfo(id) {
  const url = `${baseUrl}/anime/${id}`;
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);

  const episodes = [];
  $(".episode-item").each((idx, el) => {
    episodes.push({
      id: $(el).attr("data-ep-id"),
      episode: idx + 1,
      title: $(el).text().trim(),
    });
  });

  return {
    id,
    title: $(".anime-title").text().trim(),
    image: $(".poster img").attr("src"),
    description: $(".overview").text().trim(),
    episodes,
  };
}

/**
 * Fetch stream sources (HLS / m3u8 or mp4) for an episode.
 * @param {string} episodeId
 * @returns {Promise<{ sources: Array<{ url: string, quality: string, isM3U8: boolean }>, subtitles?: Array<{ url: string, lang: string }> }>}
 */
async function fetchEpisodeSources(episodeId) {
  const url = `${baseUrl}/api/source/${episodeId}`;
  const { data } = await axios.get(url);

  return {
    sources: [
      {
        url: data.streamUrl,
        quality: "1080p",
        isM3U8: data.streamUrl.includes(".m3u8"),
      },
    ],
    subtitles: data.tracks || [],
  };
}

/**
 * Fetch latest/airing releases for the home catalog.
 * @param {number} [page=1]
 * @returns {Promise<Array<{ id: string, title: string, episode: number, image: string }>>}
 */
async function fetchRecentEpisodes(page = 1) {
  const url = `${baseUrl}/airing?page=${page}`;
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const list = [];

  $(".airing-card").each((_, el) => {
    list.push({
      id: $(el).attr("data-id"),
      title: $(el).find(".title").text().trim(),
      episode: parseInt($(el).find(".ep-num").text(), 10) || 1,
      image: $(el).find("img").attr("src"),
    });
  });

  return list;
}

module.exports = {
  name: "mysite",
  version: "1.0.0",
  baseUrl,
  SearchAnime,
  AnimeInfo,
  fetchEpisodeSources,
  fetchRecentEpisodes,
};
```

---

## 6. Manga Extension Specification

A Manga extension module exports methods to search, list chapters, and fetch reader image URLs.

```javascript
// extensions/Manga/mymanga.js
const cheerio = require("cheerio");
const axios = global.axios || require("axios");

const baseUrl = "https://mymanga.org";

async function SearchManga(query) {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const results = [];

  $(".manga-entry").each((_, el) => {
    results.push({
      id: $(el).find("a").attr("href").replace("/manga/", ""),
      title: $(el).find(".name").text().trim(),
      image: $(el).find("img").attr("src"),
    });
  });

  return results;
}

async function MangaInfo(id) {
  const url = `${baseUrl}/manga/${id}`;
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);

  const chapters = [];
  $(".chapter-row").each((idx, el) => {
    chapters.push({
      id: $(el).find("a").attr("href").replace("/chapter/", ""),
      chapter: parseFloat($(el).attr("data-num")) || idx + 1,
      title: $(el).find(".chap-title").text().trim(),
    });
  });

  return {
    id,
    title: $(".manga-heading").text().trim(),
    image: $(".cover img").attr("src"),
    description: $(".synopsis").text().trim(),
    author: $(".author").text().trim(),
    chapters,
  };
}

async function fetchChapterImages(chapterId) {
  const url = `${baseUrl}/chapter/${chapterId}`;
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const images = [];

  $(".reader-image").each((idx, el) => {
    images.push({
      page: idx + 1,
      url: $(el).attr("data-src") || $(el).attr("src"),
    });
  });

  return images;
}

module.exports = {
  name: "mymanga",
  version: "1.0.0",
  baseUrl,
  SearchManga,
  MangaInfo,
  fetchChapterImages,
};
```

---

## 7. Declarative Header & Stream Rules

Many CDN and streaming servers require custom `Referer` or `Origin` headers to serve video chunks or manga images. Rather than hardcoding these into StrawVerse core, extensions export declarative rules:

```javascript
module.exports = {
  name: "mysite",
  version: "1.0.0",

  // General request headers for web requests
  headerRules: [
    {
      match: ["mysite.to", "mycdn.net"],
      headers: {
        Referer: "https://mysite.to/",
      },
    },
  ],

  // Headers attached to subrequests (e.g. video segments in MPV or image fetches)
  subrequestHeaders: [
    {
      match: ["megavideo.buzz", "streamcdn.org"],
      headers: {
        Referer: "https://mysite.to/",
        Origin: "https://mysite.to",
      },
    },
  ],
};
```

### Dynamic Stream Headers Registration

If your scraper resolves a stream server dynamically inside `fetchEpisodeSources`, you can register headers on the fly:

```javascript
if (typeof global.registerStreamHeaders === "function") {
  global.registerStreamHeaders("dynamiccdn.net", {
    Referer: "https://mysite.to/",
    "User-Agent": "Mozilla/5.0 ...",
  });
}
```

---

## 8. Cloudflare & Anti-Bot Bypass Rules

StrawVerse features an automated Cloudflare clearance solver. If a target site or its video host has anti-bot challenges, declare them in your scraper:

```javascript
module.exports = {
  name: "mysite",
  version: "1.0.0",

  // Domains that should trigger bypass when a 403 / challenge occurs
  bypassDomains: ["mysite.to", "streamserver.cx"],

  // Share cookies across mirrors / CDNs
  cookieDomains: ["mysite.to", "mysite.pw", "mysitecdn.com"],

  // Map CDNs to parent domain clearance
  domainAliases: {
    "cdn1.mysite.com": "mysite.to",
  },

  // Optional: predicate to verify when the destination page is completely loaded
  isPageLoaded: (title, html) => {
    return title.includes("MySite") && !html.includes("cf-challenge");
  },
};
```

---

## 9. Standard Media Info Response & Automatic Mapping

StrawVerse automatically connects provider titles with canonical MyAnimeList (MAL) records using the centralized mapping database (`mapping.db`).

- **Clean Local Metadata:** Titles mapped to MAL show official covers, seasonal releases, genres, and airing schedules directly from MyAnimeList without duplicate database bloat.
- **Provider-Exclusive Catalog:** Series not available on MyAnimeList appear dynamically under the **Unique to &lt;Provider&gt;** dropdown.
- **Automated Catalog Sync:** StrawVerse core automatically handles unmapped series detection, caching in `unmapped_items`, and reporting to the central catalog server. **Extensions do NOT need to write boilerplate code or manage database tables.**

---

### 1. Standard Info Response Format

Your `AnimeInfo(id)` or `MangaInfo(id)` function should return an object containing the standard metadata fields. StrawVerse uses these fields to populate the UI and handle catalog synchronization. Any extra properties not in this list will simply be ignored:

```javascript
async function AnimeInfo(id) {
  return {
    id: id, // String: Unique identifier or slug on the source site
    title: "Chainsaw Man", // String: Main display title
    image: "https://example.com/poster.jpg", // String: Vertical poster image URL
    type: "TV", // String: "TV" | "Movie" | "OVA" | "ONA" | "Special" | "Manga" | "Manhwa"
    description: "Denji is a teenage boy...", // String: Plot summary / synopsis
    genres: ["Action", "Supernatural"], // Array<String>: List of genre tags
    status: "Completed", // String: "Ongoing" | "Completed" | "Upcoming"
    season: "Fall", // String: "Winter" | "Spring" | "Summer" | "Fall" (optional)
    year: 2022, // Number/String: Release year (optional)
    episodes: 12, // Number or Array of episode objects
    chapters: 150, // Number or Array of chapter objects (for Manga)
    aired: "Oct 12, 2022 to Dec 28, 2022", // String: Broadcast date range (optional)
    studio: "MAPPA", // String: Production studio (or author/artist for Manga)
    duration: "24 min per ep", // String: Episode runtime (optional)
    malid: 44511, // Number: (Optional) Pre-linked MyAnimeList ID if site links to MAL
  };
}
```

> **Note on `MappingRules`:** Because all extensions return this standardized info object. StrawVerse automatically reads the standard fields directly from the response.

---

### 2. Edge Case Support: `onInfoFetched` & Scoped Storage (Optional)

For 99% of extensions, no extra hooks are needed. However, if your extension handles unique provider edge cases (such as AnimePahe's rotating UUIDs or custom token sessions), you can optionally implement `onInfoFetched({ id, info, api })`:

```javascript
// OPTIONAL: Only needed for complex provider edge cases (e.g. rotating UUIDs)
async function onInfoFetched({ id, info, api }) {
  if (!id || !info || !api) return;
  try {
    // Check if the item has an established MAL mapping
    const isMapped = await api.isMapped(id);
    const mappedMalId = await api.getMappedMalId(id);

    // Report or update custom provider-specific mapping relations
    if (info.malid && mappedMalId !== info.malid) {
      await api.reportMapping({
        uuid: id,
        id: info.dataId,
        malid: info.malid,
        name: info.title,
      });
    }
  } catch (_) {}
}
```

Extensions can also safely store extension-specific state via `getExtensionDb(providerName, repoOwner)`:

- Scoped tables (e.g. `@"repoOwner/providerName"`) guarantee isolated storage without collisions.
- Settings key-value pairs can be saved and retrieved via `getSetting(key)` and `setSetting(key, value)`.

---

## 10. Security Restrictions & Sandbox

To protect StrawVerse users against malicious code and data tampering, all extensions undergo **static security analysis** prior to installation and **runtime sandbox enforcement** during execution:

- ❌ **Zero Database Access:** Extensions cannot access database instances (`global.db`, `global.mappingDb`) or require database modules
- ❌ **Prohibited Modules:** You cannot require `child_process`, `fs`, `worker_threads`, `cluster`, `electron`, `vm`, or `v8`.
- ❌ **Process Manipulation:** `process.exit()`, `process.kill()`, `process.abort()`, and `process.binding()` are strictly blocked.
- 🔒 **Namespace Isolation:** Unofficial extensions are strictly namespaced as `@<username>/<extension>` in all catalogs and storage, preventing provider impersonation.
- ✅ **Safe Allowed Modules:**
  - `cheerio` (HTML parsing)
  - `axios` (HTTP requests)
  - `crypto` (Hashing, MD5, SHA256, AES)
  - `buffer`, `url`, `querystring`, `path`, `stream`, `zlib`, `events`, `util`

Any extension violating these security rules will be rejected with a `Security Verification Failed` error.

---

## 11. Publishing & Adding Your Repo to StrawVerse

1. Push your repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial extension release"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

```

2. In StrawVerse:
   - Navigate to **Extensions** (Marketplace).
   - Click the **+ Add Repo** button in the header.
   - Enter your repository URL (e.g., `https://github.com/<your-username>/<your-repo-name>`).
   - Click **Add Repository**.
3. All extensions in your repository will immediately appear in the marketplace labeled with `@<your-username>`! Users can click **Install Scraper** to begin using your extensions.
```

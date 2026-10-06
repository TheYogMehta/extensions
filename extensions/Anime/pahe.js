/**
 * StrawVerse Extension - AnimePahe Scraper
 * Copyright (C) 2026 TheYogMehta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * DISCLAIMER: This extension is intended for research, educational,
 * and developer testing purposes only. It functions as a client-side parser
 * of publicly available web pages. The developers do not host or distribute
 * any copyrighted media. Users are responsible for compliance with the terms of
 * service of the target website.
 */

// imports
const cheerio = require("cheerio");

// variables
// Mirror priority: hosts that may serve the real API behind Cloudflare
// (403 to bots, solvable via in-app CF bypass) come BEFORE known
// WordPress clones (.ng/.ch return 200 + HTML with no API).
// safeGet validates response SHAPE, so dead/clone mirrors are skipped
// automatically instead of silently poisoning results.
const baseUrls = [
  "https://animepahe.pw",
  "https://animepahe.com",
  "https://animepahe.org",
  "https://animepahe.io",
  "https://animepahe.ng",
  "https://animepahe.ch",
];
let baseUrl = baseUrls[0];

function swapBase(url, base) {
  return String(url).replace(/https:\/\/animepahe\.[a-z]+/i, base);
}

function isCloneHtml(data) {
  if (typeof data !== "string") return false;
  return (
    data.includes("wp-content") ||
    data.includes("yoast") ||
    data.includes("WordPress") ||
    /<html[^>]*lang="en-US"[^>]*>\s*<head[^>]*>\s*<meta http-equiv="Content-Type"/i.test(
      data.slice(0, 2000),
    )
  );
}

function getBaseVariants(url) {
  if (!/animepahe/i.test(String(url))) return [String(url)];
  const seen = new Set();
  const out = [];
  // current working base first
  for (const b of [baseUrl, ...baseUrls]) {
    const v = swapBase(url, b);
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function notifyRenderer(channel, payload) {
  if (typeof global.sendToRenderer === "function") {
    try {
      global.sendToRenderer(channel, payload);
    } catch (_) {}
  }
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500;

let lastDirectorySyncTime = 0;
let isDirectorySyncRunning = false;
const DIRECTORY_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour

async function getSavedSetting(key) {
  if (!global.db) return null;
  try {
    const row = await global.db
      .prepare("SELECT value FROM Settings WHERE key = ?")
      .get(key);
    return row ? row.value : null;
  } catch (_) {
    return null;
  }
}

async function setSavedSetting(key, value) {
  if (!global.db) return;
  try {
    await global.db
      .prepare("INSERT OR REPLACE INTO Settings (key, value) VALUES (?, ?)")
      .run(key, String(value));
  } catch (_) {}
}

async function getSavedOnePieceUuid() {
  // 1. Check Settings in database.db
  const fromSettings = await getSavedSetting("pahe_one_piece_uuid");
  if (fromSettings) return fromSettings.trim();

  // 2. Check mapping.db pahe table for One Piece (id '4' or malid 21)
  if (global.mappingDb) {
    try {
      const row = await global.mappingDb
        .prepare("SELECT uuid FROM pahe WHERE id = '4' OR malid = 21 LIMIT 1")
        .get();
      if (row?.uuid) return row.uuid.trim();
    } catch (_) {}
  }
  return null;
}

async function syncPaheDirectory(brokenUuid = null) {
  if (isDirectorySyncRunning) return null;
  isDirectorySyncRunning = true;
  lastDirectorySyncTime = Date.now();

  try {
    console.log("[AnimePahe] Starting 1h background /anime directory sync...");

    let html = "";
    // 1. Try in-app browser session first if Cloudflare clearance is available
    if (typeof global.scrapperFetch === "function") {
      try {
        html = await global.scrapperFetch(`${baseUrl}/anime`);
      } catch (_) {}
    }

    // 2. Try direct safeGet with skipDirectorySync
    if (!html) {
      try {
        const catalogRes = await safeGet(
          `${baseUrl}/anime`,
          { skipDirectorySync: true },
          2,
        );
        html = typeof catalogRes?.data === "string" ? catalogRes.data : "";
      } catch (_) {}
    }

    // 3. Fallback to mirrors
    if (!html) {
      const mirrors = [
        "https://animepahe.pw",
        "https://animepahe.org",
        "https://animepahe.com",
        "https://animepahe.io",
        "https://animepahe.ng",
        "https://animepahe.ch",
      ];
      for (const m of mirrors) {
        if (m === baseUrl) continue;
        try {
          if (typeof global.scrapperFetch === "function") {
            html = await global.scrapperFetch(`${m}/anime`);
          }
          if (!html) {
            const res = await safeGet(
              `${m}/anime`,
              { skipDirectorySync: true },
              1,
            );
            html = typeof res?.data === "string" ? res.data : "";
          }
          if (html && (html.includes("/anime/") || html.includes("animepahe")))
            break;
        } catch (_) {}
      }
    }

    if (!html) {
      console.warn("[AnimePahe] Could not retrieve /anime directory HTML.");
      return null;
    }

    const links = [];
    let tsv = "";
    try {
      const $ = cheerio.load(html);
      $("a[href*='/anime/']").each((_, el) => {
        const href = $(el).attr("href") || "";
        const match = href.match(
          /\/anime\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
        );
        if (match) {
          const u = match[1].toLowerCase().trim();
          const n = ($(el).text().trim() || $(el).attr("title") || "")
            .replace(/[\r\n\t]+/g, " ")
            .trim();
          if (u && n) {
            links.push({ uuid: u, name: n });
            tsv += `${u}\t${n}\n`;
          }
        }
      });
    } catch (_) {}

    if (links.length === 0) {
      const linkRegex =
        /<a\s+[^>]*href="\/anime\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        const u = m[1].toLowerCase().trim();
        const n = (m[2] || "")
          .replace(/<[^>]+>/g, "")
          .replace(/[\r\n\t]+/g, " ")
          .trim();
        if (u && n) {
          links.push({ uuid: u, name: n });
          tsv += `${u}\t${n}\n`;
        }
      }
    }

    if (links.length === 0) {
      console.warn("[AnimePahe] No anime links found in /anime HTML.");
      return null;
    }

    console.log(
      `[AnimePahe] Parsed ${links.length} anime entries from /anime directory.`,
    );

    // Record last sync check time in Settings
    await setSavedSetting("pahe_directory_sync_time", String(Date.now()));

    // 4. One Piece UUID rotation canary check
    const opEntry = links.find((l) => /^one piece$/i.test(l.name.trim()));
    const currentOpUuid = opEntry?.uuid || null;
    const savedOpUuid = await getSavedOnePieceUuid();

    console.log(
      `[AnimePahe] Canary One Piece UUID check - Current: ${currentOpUuid || "not found"}, Saved: ${savedOpUuid || "none"}`,
    );

    // If One Piece UUID hasn't changed and no brokenUuid requested, skip server sync!
    if (
      savedOpUuid &&
      currentOpUuid &&
      savedOpUuid.toLowerCase() === currentOpUuid.toLowerCase() &&
      !brokenUuid
    ) {
      console.log(
        `[AnimePahe] One Piece canary UUID unchanged (${currentOpUuid}). Skipping sync to server.`,
      );
      return {
        links,
        resolvedNewUuid: null,
        version: null,
        skipped: true,
      };
    }

    console.log(
      `[AnimePahe] UUID rotation detected or initial sync (current OP: ${currentOpUuid}, saved OP: ${savedOpUuid}). Posting catalog to mapping server...`,
    );

    // 5. Post to mapping index server so all entries are mapped to MAL IDs
    const client = global.axios || require("axios");
    const syncEndpoints = [
      "https://strawverse.theyogmehta.online/api/pahe/index",
      "http://localhost:33544/api/pahe/index",
    ];

    let syncRes = null;
    for (const endpoint of syncEndpoints) {
      try {
        syncRes = await client.post(
          endpoint,
          { brokenUuid, catalog: tsv, links },
          { timeout: 35000 },
        );
        if (syncRes?.status === 200 && syncRes.data?.success) {
          console.log(
            `[AnimePahe] Successfully synced directory to ${endpoint}. Server updated ${syncRes.data.updatedCount || 0} mappings.`,
          );
          break;
        }
      } catch (_) {}
    }

    // 6. If server returned updated mappings, apply directly to local mappingDb
    if (
      global.mappingDb &&
      syncRes?.data?.updatedMappings &&
      Array.isArray(syncRes.data.updatedMappings)
    ) {
      try {
        let applied = 0;
        for (const m of syncRes.data.updatedMappings) {
          if (m.newUuid) {
            if (m.id) {
              await global.mappingDb
                .prepare("UPDATE pahe SET uuid = ? WHERE id = ?")
                .run(m.newUuid, m.id);
              applied++;
            } else if (m.malid) {
              await global.mappingDb
                .prepare("UPDATE pahe SET uuid = ? WHERE malid = ?")
                .run(m.newUuid, m.malid);
              applied++;
            }
          }
        }
        if (applied > 0) {
          console.log(
            `[AnimePahe] Applied ${applied} updated MAL ID mappings to local mappingDb.`,
          );
        }
      } catch (errLocalMap) {
        console.warn(
          "[AnimePahe] Failed applying mappings to mappingDb:",
          errLocalMap?.message,
        );
      }
    }

    // 7. Update One Piece in local mappingDb and Settings table
    if (currentOpUuid) {
      if (global.mappingDb) {
        try {
          await global.mappingDb
            .prepare("UPDATE pahe SET uuid = ? WHERE id = '4' OR malid = 21")
            .run(currentOpUuid);
        } catch (_) {}
      }
      await setSavedSetting("pahe_one_piece_uuid", currentOpUuid);
    }

    // 8. Trigger mapping updates check so StrawVerse downloads latest delta release
    if (typeof global.checkForMappingUpdates === "function") {
      try {
        await global.checkForMappingUpdates(true);
      } catch (_) {}
    }

    return {
      links,
      resolvedNewUuid: syncRes?.data?.resolvedNewUuid || null,
      version: syncRes?.data?.version || null,
    };
  } catch (err) {
    console.error("[AnimePahe] Directory sync error:", err?.message);
    return null;
  } finally {
    isDirectorySyncRunning = false;
  }
}

async function triggerHourlyDirectorySync() {
  const now = Date.now();
  if (isDirectorySyncRunning) return;
  if (now - lastDirectorySyncTime < DIRECTORY_SYNC_INTERVAL) return;

  if (lastDirectorySyncTime === 0) {
    try {
      const savedTime = await getSavedSetting("pahe_directory_sync_time");
      if (savedTime && now - Number(savedTime) < DIRECTORY_SYNC_INTERVAL) {
        lastDirectorySyncTime = Number(savedTime);
        return;
      }
    } catch (_) {}
  }

  lastDirectorySyncTime = now;
  setTimeout(() => {
    syncPaheDirectory().catch(() => {});
  }, 200);
}

async function safeGet(url, config = {}, maxRetries = 5, opts = {}) {
  if (!config.skipDirectorySync) {
    triggerHourlyDirectorySync();
  }
  const expectJson = !!opts.expectJson;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_REQUEST_INTERVAL) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLast),
      );
    }
    lastRequestTime = Date.now();

    const variants = getBaseVariants(url);
    for (const tryUrl of variants) {
      const tryBase =
        (/https:\/\/animepahe\.[a-z]+/i.exec(tryUrl) || [])[0] || baseUrl;
      const isApi = tryUrl.includes("/api?");
      const mergedHeaders = {
        Referer: tryBase + "/",
        ...(isApi
          ? {
              "X-Requested-With": "XMLHttpRequest",
              Accept: "application/json, text/javascript, */*; q=0.01",
            }
          : {
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            }),
        ...(config.headers || {}),
      };
      const reqConfig = {
        ...config,
        headers: mergedHeaders,
      };

      try {
        const response = await global.axios.get(tryUrl, reqConfig);
        let data = response?.data;

        if (isApi && typeof data === "string") {
          try {
            data = JSON.parse(data);
            response.data = data;
          } catch (_) {}
        }

        // Mirror validation: clones squat animepahe domains and return 200 +
        // WordPress HTML (or JS shells). Without shape checks that poison
        // silently becomes empty search/episode/source lists downstream.
        if (expectJson) {
          const looksJson =
            data &&
            typeof data === "object" &&
            (Array.isArray(data.data) ||
              typeof data.total !== "undefined" ||
              typeof data.last_page !== "undefined");
          if (!looksJson) {
            console.warn(
              `[AnimePahe] ${tryBase} returned non-API payload, trying next mirror...`,
            );
            lastErr = Object.assign(
              new Error(`Invalid API response from ${tryBase}`),
              { code: "BAD_MIRROR" },
            );
            continue; // next variant
          }
        } else if (typeof data === "string" && isCloneHtml(data)) {
          console.warn(
            `[AnimePahe] ${tryBase} looks like a clone site, trying next mirror...`,
          );
          lastErr = Object.assign(new Error(`Clone site at ${tryBase}`), {
            code: "BAD_MIRROR",
          });
          continue; // next variant
        }

        const isRateLimited =
          response?.status === 429 ||
          data?.status === 429 ||
          data?.error_code === 1015 ||
          data?.title?.includes("rate limited") ||
          (typeof data === "string" &&
            (data.includes("error code: 1015") ||
              data.includes("rate limited")));

        if (isRateLimited) {
          if (attempt < maxRetries) {
            const totalWaitSecs =
              Math.max(4, Math.ceil(data?.retry_after || 4)) * attempt;
            console.warn(
              `[AnimePahe] Rate limited (Attempt ${attempt}/${maxRetries}). Waiting ${totalWaitSecs}s...`,
            );
            for (let sec = totalWaitSecs; sec > 0; sec--) {
              notifyRenderer("catalog-loading-status", {
                text: `Rate limited by AnimePahe. Retrying in ${sec}s...`,
              });
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            notifyRenderer("catalog-loading-status", {
              text: "Retrying AnimePahe fetch...",
            });
          }
          lastErr = Object.assign(new Error("Rate limited"), {
            response: { status: 429 },
          });
          break; // backoff done above, outer retry (skips extra wait via status check)
        }

        // success -> remember working base
        baseUrl = tryBase;
        notifyRenderer("catalog-loading-status", {
          text: "",
        });
        return response;
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;
        if (status === 404) {
          // Try remaining mirrors before surfacing 404 (preserves the
          // UUID auto-heal flow when every mirror agrees it is missing).
          console.warn(`[AnimePahe] 404 on ${tryBase}, trying next mirror...`);
          continue;
        }
        // try next mirror on 403 / network errors without waiting
        const isDomainError =
          status === 403 ||
          !status ||
          [
            "ENOTFOUND",
            "EAI_AGAIN",
            "ECONNRESET",
            "ETIMEDOUT",
            "ECONNREFUSED",
          ].some((c) => String(err?.code || err?.message || "").includes(c));
        if (isDomainError) {
          console.warn(
            `[AnimePahe] ${status || "Network"} on ${tryBase}, trying next mirror...`,
          );
          try {
            if (global.cloudflarebypass && status === 403) {
              await global.cloudflarebypass(tryUrl, false, tryBase + "/");
            }
          } catch (_) {}
          continue; // next variant
        }
        break; // non-domain error -> outer retry with backoff
      }
    }
    if (attempt < maxRetries) {
      const status = lastErr?.response?.status;
      if (status === 429) {
        continue; // already waited above
      }
      const totalWaitSecs = status === 429 ? 8 * attempt : 3 * attempt;
      console.warn(
        `[AnimePahe] HTTP ${status || "Error"}. Waiting ${totalWaitSecs}s before retry ${attempt}/${maxRetries}...`,
      );
      for (let sec = totalWaitSecs; sec > 0; sec--) {
        notifyRenderer("catalog-loading-status", {
          text:
            status === 429
              ? `Rate limited by AnimePahe. Retrying in ${sec}s...`
              : `Retrying AnimePahe in ${sec}s...`,
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      notifyRenderer("catalog-loading-status", {
        text: "Retrying AnimePahe fetch...",
      });
      continue;
    }
    notifyRenderer("catalog-loading-status", {
      text: "",
    });
    throw lastErr;
  }
}

// Anime Search
async function SearchAnime(query, filters = {}) {
  const { data } = await safeGet(
    `${baseUrl}/api?m=search&q=${encodeURIComponent(query)}`,
    {
      headers: {
        Referer: baseUrl,
      },
    },
    5,
    { expectJson: true },
  );
  const res = {
    currentPage: 1,
    hasNextPage: false,
    totalPages: 1,
    results: (data?.data || []).map((item) => ({
      id: `${item.session}`,
      title: item.title,
      image: item?.poster,
    })),
  };
  return res;
}

// Recent Episodes
async function fetchRecentEpisodes(filters = {}) {
  const pageNum = filters.page || 1;
  const { data } = await safeGet(
    `${baseUrl}/api?m=airing&page=${pageNum}`,
    {
      headers: {
        Referer: baseUrl,
      },
    },
    5,
    { expectJson: true },
  );
  const res = {
    currentPage: pageNum,
    hasNextPage: data?.next_page_url?.length > 0 ? true : false,
    totalPages: data?.last_page ?? 0,
    results: (data?.data || []).map((item) => ({
      id: `${item.anime_session}`,
      title: item.anime_title,
      image: item?.snapshot,
      episode: item.episode,
    })),
  };
  return res;
}

// Animeinfo
async function AnimeInfo(id) {
  const animeInfo = {
    id: id,
    title: "",
  };

  try {
    const res = await safeGet(`${baseUrl}/anime/${id}`, {
      headers: {
        Referer: baseUrl,
      },
    });
    let data = res?.data;
    if (
      data &&
      typeof data === "object" &&
      (data.status === 404 || data.status >= 400)
    ) {
      const err404 = new Error(
        `Request failed with status code ${data.status}`,
      );
      err404.status = data.status;
      err404.response = { status: data.status, data };
      throw err404;
    }

    const $ = (0, cheerio.load)(data);

    let MalId =
      parseInt($('meta[name="myanimelist"]').attr("content") ?? null) ?? null;

    animeInfo.malid = MalId;
    if (MalId && id && global.mappingDb) {
      try {
        global.mappingDb
          .prepare(
            "INSERT INTO pahe (id, uuid, malid) VALUES (?, ?, ?) ON CONFLICT(malid) DO UPDATE SET uuid = excluded.uuid, id = excluded.id",
          )
          .run(id, id, MalId);
      } catch (_) {}
    }
    animeInfo.title = $("div.title-wrapper > h1 > span").first().text();
    const resolvePoster = (u) => {
      if (!u) return null;
      const s = String(u).trim();
      if (/^https?:\/\//i.test(s)) return s;
      if (s.startsWith("//")) return "https:" + s;
      if (s.startsWith("/")) return baseUrl + s;
      return baseUrl + "/" + s;
    };
    let image =
      resolvePoster($("div.anime-poster a").attr("href")) ??
      resolvePoster($("div.anime-poster img").attr("src")) ??
      null;
    animeInfo.image = image;
    animeInfo.description = $("div.anime-summary").text();
    animeInfo.genres = $("div.anime-genre ul li")
      .map((i, el) => $(el).find("a").attr("title"))
      .get();
    switch (
      $('div.col-sm-4.anime-info p:icontains("Status:") a').text().trim()
    ) {
      case "Currently Airing":
        animeInfo.status = "Ongoing";
        break;
      case "Finished Airing":
        animeInfo.status = "Completed";
        break;
      default:
        animeInfo.status = "Unknown";
    }

    animeInfo.type = $('div.col-sm-4.anime-info p:icontains("Type") a')
      .text()
      .trim()
      .toUpperCase();

    animeInfo.aired = $('div.col-sm-4.anime-info p:icontains("Aired")')
      .text()
      .replace("Aired:", "")
      .replaceAll("\n", " ")
      .replaceAll("  ", "")
      .trim();

    animeInfo.dataId = id;

    return animeInfo;
  } catch (error) {
    const is404 =
      error?.status === 404 ||
      error?.response?.status === 404 ||
      error?.message?.includes("404");

    if (is404 && id) {
      console.warn(
        `[AnimePahe] UUID ${id} returned 404. Fetching /anime directory to auto-heal UUID...`,
      );
      notifyRenderer("info-loading-status", {
        text: "Auto-healing AnimePahe UUID from directory, please wait...",
      });
      let resolvedNewUuid = null;
      let resolvedVersion = null;
      try {
        const syncResult = await syncPaheDirectory(id);
        if (syncResult?.resolvedNewUuid) {
          resolvedNewUuid = syncResult.resolvedNewUuid;
          resolvedVersion = syncResult.version;
          console.log(
            `[AnimePahe] Server auto-healed UUID ${id} -> ${resolvedNewUuid}`,
          );
        }
      } catch (recoveryErr) {
        console.error(
          "[AnimePahe] Failed to recover from /anime index:",
          recoveryErr.message,
        );
      } finally {
        notifyRenderer("info-loading-status", {
          text: "",
        });
      }

      if (resolvedNewUuid) {
        notifyRenderer("info-loading-status", {
          text: "Updating database with healed mapping, please wait...",
        });
        return {
          needsMappingSync: true,
          brokenUuid: id,
          newUuid: resolvedNewUuid,
          dataId: resolvedNewUuid,
          version: resolvedVersion || null,
        };
      } else {
        return {
          needsMappingSync: false,
          brokenUuid: id,
          newUuid: null,
          dataId: id,
          version: null,
        };
      }
    }

    console.error("Error fetching data from AnimePahe:", error);
    throw error;
  }
}

const firstEpCache = {};

async function getFirstEpisodeNumber(id, lastPage) {
  if (firstEpCache[id] !== undefined) {
    return firstEpCache[id];
  }
  try {
    const { data } = await safeGet(
      `${baseUrl}/api?m=release&id=${id}&sort=episode_desc&page=${lastPage}`,
      {
        headers: {
          Referer: baseUrl,
        },
      },
      5,
      { expectJson: true },
    );
    if (data?.data && data.data.length > 0) {
      const firstEp = data.data[data.data.length - 1].episode;
      firstEpCache[id] = firstEp;
      return firstEp;
    }
  } catch (err) {
    console.error("Failed to fetch first episode number:", err);
  }
  firstEpCache[id] = 1;
  return 1;
}

// Fetching Episodes Pages
async function fetchEpisode(id, page = 1) {
  try {
    let episodes = [];
    const resp = await safeGet(
      `${baseUrl}/api?m=release&id=${id}&sort=episode_desc&page=${page}`,
      {
        headers: {
          Referer: baseUrl,
        },
      },
      5,
      { expectJson: true },
    );
    const respData = resp?.data;
    if (
      !respData ||
      typeof respData !== "object" ||
      !Array.isArray(respData.data)
    ) {
      return {
        episodes: [],
        totalPages: 0,
        total: 0,
        currentPage: page,
      };
    }
    const { last_page, data, total } = respData;

    const firstEpNum = await getFirstEpisodeNumber(id, last_page);
    const offset = firstEpNum - 1;

    data.forEach((item) => {
      let hasEngAudio = item?.audio && item?.audio?.toLowerCase() === "eng";
      let mappedNumber = item.episode - offset;
      if (mappedNumber < 1) mappedNumber = item.episode;

      const langs = ["sub"];
      if (hasEngAudio) langs.push("dub");

      episodes.push({
        id: `${id}/${item.session}`,
        number: mappedNumber,
        title: item.title,
        duration: item.duration,
        langs,
      });
    });

    return {
      episodes: episodes,
      totalPages: last_page,
      total: total,
      currentPage: page,
    };
  } catch (err) {
    if (
      err?.response?.status === 404 ||
      err?.status === 404 ||
      err?.message?.includes("404")
    ) {
      throw err;
    }
    return { episodes: [], totalPages: 0, total: 0, currentPage: page };
  }
}

// fetching Episodes Download Links
async function fetchEpisodeSources(episodeId, category = null) {
  try {
    const { data } = await safeGet(`${baseUrl}/play/${episodeId}`, {
      headers: {
        Referer: baseUrl,
      },
    });
    const $ = (0, cheerio.load)(data);

    let linksArray = $("div#resolutionMenu > button")
      .map((i, el) => ({
        url: $(el).attr("data-src"),
        quality: extractQualityNumber($(el).text()),
        audio: $(el).attr("data-audio"),
      }))
      .get();

    if (category) {
      const catLower = category.toLowerCase();
      if (catLower === "dub") {
        const filtered = linksArray.filter((l) => l.audio === "eng");
        if (filtered.length > 0) linksArray = filtered;
      } else if (catLower === "sub") {
        const filtered = linksArray.filter((l) => l.audio !== "eng");
        if (filtered.length > 0) linksArray = filtered;
      }
    }

    if (linksArray.length === 0) {
      return { sources: [], subtitles: [] };
    }

    const sources = linksArray.map((l) => ({
      quality: l.quality || "auto",
      name: `Server ${l.quality}`,
      url: l.url,
      lang: l.audio === "eng" ? "dub" : "sub",
      type: l.audio === "eng" ? "dub" : "sub",
      isUnresolved: true,
      rawServer: l,
    }));

    return {
      sources,
      subtitles: [],
    };
  } catch (err) {
    console.error("Error fetching data from AnimePahe:", err);
    return { sources: [], subtitles: [] };
  }
}

async function processServer(server) {
  if (!server?.url) return null;
  try {
    const embedUrlObj = new URL(server.url);
    const playerReferer = embedUrlObj.origin + "/";
    const res = await extract(embedUrlObj);
    if (res && res[0]) {
      const streamUrl = res[0].url;
      try {
        const streamDomain = new URL(streamUrl).hostname;
        if (global.setDynamicReferer) {
          global.setDynamicReferer(streamDomain, playerReferer);
          global.setFallbackReferer(playerReferer);
        }
      } catch (e) {}

      return {
        url: streamUrl,
        quality: server.quality || "auto",
        isM3U8: res[0].isM3U8 || streamUrl.includes(".m3u8"),
        headers: { Referer: playerReferer },
        lang: server.audio === "eng" ? "dub" : "sub",
        type: server.audio === "eng" ? "dub" : "sub",
      };
    }
  } catch (err) {
    console.error("Failed to extract server:", err.message);
  }
  return null;
}

// helpers for extracting video links
function extractQualityNumber(qualityString) {
  const match = qualityString.match(/\d+p/);
  return match ? match[0] : "";
}

// helpers for extracting video links
async function extract(videoUrl, retries = 3, delay = 1000) {
  let sources = [];
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await global.axios.get(videoUrl.href, {
        headers: {
          Referer: baseUrl + "/",
        },
      });
      const match = /(eval)(\(f.*?)(<\/script>)/s.exec(data);
      if (!match) {
        throw new Error("Failed to find video source packer block");
      }
      const source = eval(match[2].replace("eval", "")).match(/https.*?m3u8/);
      sources.push({
        url: source[0],
        isM3U8: source[0].includes(".m3u8"),
      });
      return sources;
    } catch (err) {
      if (attempt < retries) {
        console.warn(
          `Resolving ${videoUrl.href} failed (${err.response?.status || err.message}). Retrying in ${delay}ms (attempt ${attempt}/${retries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw new Error(err.message);
    }
  }
}

module.exports = {
  name: "pahe",
  version: "5.0.6",
  SearchAnime,
  AnimeInfo,
  fetchEpisodeSources,
  processServer,
  fetchRecentEpisodes,
  fetchEpisode,
};

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
// (403 to bots, solvable via in-app CF bypass) come first; .pw is the
// proven API host and stays at the front. safeGet validates response
// SHAPE, so dead/clone mirrors are skipped automatically instead of
// silently poisoning results.
const baseUrls = [
  "https://animepahe.pw",
  "https://animepahe.com",
  "https://animepahe.org",
];
let baseUrl = baseUrls[0];

// Hosts that recently failed are tried last for a while, so one dead
// mirror can't stall every call.
const mirrorCooldownUntil = {};
const MIRROR_COOLDOWN_MS = 5 * 60 * 1000;

function markMirrorDown(base) {
  try {
    mirrorCooldownUntil[String(base)] = Date.now() + MIRROR_COOLDOWN_MS;
  } catch (_) {}
}

function markMirrorOk(base) {
  try {
    delete mirrorCooldownUntil[String(base)];
  } catch (_) {}
}

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
  const now = Date.now();
  const fresh = [];
  const cooling = [];
  for (const v of out) {
    const host = (/https:\/\/animepahe\.[a-z]+/i.exec(v) || [])[0] || v;
    (mirrorCooldownUntil[host] && mirrorCooldownUntil[host] > now
      ? cooling
      : fresh
    ).push(v);
  }
  return [...fresh, ...cooling];
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

let isDirectorySyncRunning = false;

function getExtensionDatabase() {
  if (typeof global.getExtensionDb === "function") {
    return global.getExtensionDb("pahe", "TheYogMehta");
  }
  return null;
}

async function getSavedSetting(key) {
  const db = getExtensionDatabase();
  if (db?.getSetting) {
    return await db.getSetting(key);
  }
  return null;
}

async function setSavedSetting(key, value) {
  const db = getExtensionDatabase();
  if (db?.setSetting) {
    await db.setSetting(key, value);
  }
}

async function getSavedOnePieceUuid() {
  const fromSettings = await getSavedSetting("pahe_one_piece_uuid");
  if (fromSettings) return fromSettings.trim();
  const db = getExtensionDatabase();
  if (db) {
    try {
      const row = await db
        .prepare("SELECT uuid FROM pahe WHERE id = '4' OR malid = 21 LIMIT 1")
        .get();
      if (row?.uuid) return row.uuid.trim();
    } catch (_) {}
  }
  return null;
}

function isValidPaheUuid(str) {
  return (
    typeof str === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      str.trim(),
    )
  );
}

async function resolvePaheUuid(id) {
  if (!id) return null;
  const cleanId = String(id).trim();
  if (isValidPaheUuid(cleanId)) return cleanId.toLowerCase();

  const db = getExtensionDatabase();
  if (db) {
    try {
      const row = await db
        .prepare("SELECT uuid FROM pahe WHERE id = ? LIMIT 1")
        .get(cleanId);
      if (row?.uuid && isValidPaheUuid(row.uuid)) {
        return row.uuid.trim().toLowerCase();
      }
    } catch (_) {}
  }

  if (global.mappingDb) {
    try {
      const row = global.mappingDb
        .prepare("SELECT uuid FROM pahe WHERE id = ? LIMIT 1")
        .get(cleanId);
      if (row?.uuid && isValidPaheUuid(row.uuid)) {
        return row.uuid.trim().toLowerCase();
      }
    } catch (_) {}
  }

  return cleanId;
}

async function resolvePaheId(uuid) {
  if (!uuid) return null;
  const cleanUuid = String(uuid).trim();
  if (!isValidPaheUuid(cleanUuid)) return cleanUuid;

  const db = getExtensionDatabase();
  if (db) {
    try {
      const row = await db
        .prepare("SELECT id FROM pahe WHERE uuid = ? LIMIT 1")
        .get(cleanUuid.toLowerCase());
      if (row?.id) return String(row.id).trim();
    } catch (_) {}
  }

  if (global.mappingDb) {
    try {
      const row = global.mappingDb
        .prepare("SELECT id FROM pahe WHERE uuid = ? LIMIT 1")
        .get(cleanUuid.toLowerCase());
      if (row?.id) return String(row.id).trim();
    } catch (_) {}
  }

  return cleanUuid;
}

async function syncPaheDirectory(
  brokenUuid = null,
  cachedHtml = null,
  forceSync = false,
) {
  if (isDirectorySyncRunning) return null;
  isDirectorySyncRunning = true;

  try {
    console.log("[AnimePahe] Starting /anime directory sync...");

    let html = cachedHtml || "";
    // 1. Try in-app browser session first if Cloudflare clearance is available
    if (!html && typeof global.scrapperFetch === "function") {
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
          if (html && html.includes("/anime/")) break;
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

    // If One Piece UUID hasn't changed and no brokenUuid requested and not forced, skip server sync!
    if (
      !forceSync &&
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
      `[AnimePahe] UUID rotation detected or initial sync (current OP: ${currentOpUuid}, saved OP: ${savedOpUuid}, force: ${forceSync}). Posting catalog to mapping server...`,
    );

    // 5. Post to mapping index server so all entries are mapped to MAL IDs
    const client = global.axios || require("axios");
    const syncEndpoints = [
      "https://strawverse.theyogmehta.online/api/pahe/index",
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

    if (currentOpUuid) {
      const db = getExtensionDatabase();
      if (db) {
        try {
          await db
            .prepare("UPDATE pahe SET uuid = ? WHERE id = '4' OR malid = 21")
            .run(currentOpUuid);
        } catch (_) {}

        try {
          const unmappedRows = await db
            .prepare(
              "SELECT id, name FROM unmapped_items WHERE provider = 'pahe'",
            )
            .all();
          if (Array.isArray(unmappedRows) && unmappedRows.length > 0) {
            for (const row of unmappedRows) {
              const matched = links.find(
                (l) =>
                  l.name.trim().toLowerCase() ===
                  (row.name || "").trim().toLowerCase(),
              );
              if (matched && matched.uuid && matched.uuid !== row.id) {
                console.log(
                  `[AnimePahe] Healing unmapped item '${row.name}': ${row.id} -> ${matched.uuid}`,
                );
                await db
                  .prepare(
                    "UPDATE unmapped_items SET id = ? WHERE provider = 'pahe' AND id = ?",
                  )
                  .run(matched.uuid, row.id);
              }
            }
          }
        } catch (_) {}
      }
      await setSavedSetting("pahe_one_piece_uuid", currentOpUuid);
    }

    // 7. Trigger mapping updates check so StrawVerse downloads latest delta release
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

async function safeGet(url, config = {}, maxRetries = 5, opts = {}) {
  const expectJson = !!opts.expectJson;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const u = new URL(url);
      console.log(`[AnimePahe] GET ${u.hostname}${u.pathname} (attempt ${attempt}/${maxRetries})`);
    } catch (_) {}
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
            markMirrorDown(tryBase);
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
        markMirrorOk(tryBase);
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
          markMirrorDown(tryBase);
          console.warn(`[AnimePahe] 404 on ${tryBase}, trying next mirror...`);
          continue;
        }
        // Only switch mirrors if the host is unreachable / down, NOT on 403 Cloudflare challenge!
        const isMirrorDown =
          status === 502 ||
          status === 504 ||
          (!status &&
            [
              "ENOTFOUND",
              "EAI_AGAIN",
              "ECONNRESET",
              "ETIMEDOUT",
              "ECONNREFUSED",
            ].some((c) => String(err?.code || err?.message || "").includes(c)));
        if (isMirrorDown) {
          markMirrorDown(tryBase);
          console.warn(
            `[AnimePahe] Mirror ${tryBase} is down (${err?.code || status || "Network"}), trying next mirror...`,
          );
          continue; // next variant
        }
        break; // 403 or other response -> stay on current mirror
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
async function SearchAnime(query) {
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

  const rawList = data?.data || [];
  const db = getExtensionDatabase();

  const results = [];
  for (const item of rawList) {
    const itemSession = item?.session
      ? String(item.session).trim().toLowerCase()
      : null;
    const itemId = item?.id ? String(item.id).trim() : null;
    const finalId = itemId || itemSession;

    if (db && itemId && itemSession) {
      try {
        await db
          .prepare(
            "INSERT INTO pahe (id, uuid) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET uuid = excluded.uuid",
          )
          .run(itemId, itemSession);
      } catch (_) {}
    }

    results.push({
      id: finalId,
      title: item.title,
      image: item?.poster,
    });
  }

  const res = {
    currentPage: 1,
    hasNextPage: false,
    totalPages: 1,
    results,
  };
  return res;
}

function parseRecentEpisodesFromHtml(html) {
  if (!html || typeof html !== "string") return [];
  try {
    const $ = (0, cheerio.load)(html);
    const results = [];
    $(".episode-wrap").each((_, el) => {
      const $el = $(el);
      const playHref = $el.find("a.play").attr("href") || "";
      const animeHref = $el.find(".episode-title a").attr("href") || "";
      const match =
        animeHref.match(/\/anime\/([0-9a-f-]{36})/i) ||
        playHref.match(/\/play\/([0-9a-f-]{36})/i);
      const uuid = match ? match[1] : "";
      const title =
        $el.find(".episode-title a").attr("title") ||
        $el.find(".episode-title a").text().trim();
      const $img = $el.find(".episode-snapshot img");
      const image =
        $img.attr("data-src") ||
        $img.attr("src") ||
        $img.attr("data-original") ||
        "";
      const epWrap = $el.find(".episode-number").clone();
      epWrap.find(".text-hide").remove();
      const epNum = parseFloat(epWrap.text().trim()) || 1;
      if (uuid && title) {
        results.push({
          id: uuid,
          title,
          image,
          episode: epNum,
        });
      }
    });
    return results;
  } catch (_) {
    return [];
  }
}

function generateNormalizedTitleCandidates(rawTitle) {
  if (!rawTitle || typeof rawTitle !== "string") return [];
  const candidates = new Set();
  const trimmed = rawTitle.trim();
  if (!trimmed) return [];

  candidates.add(trimmed);

  const noDots = trimmed.replace(/[\.…]+\s*$/, "").trim();
  if (noDots && noDots !== trimmed) candidates.add(noDots);

  const noParen = trimmed
    .replace(/\s*\((?:tv|ona|ova|movie|special|dub|sub|\d{4})\)\s*$/i, "")
    .trim();
  if (noParen && noParen !== trimmed) candidates.add(noParen);

  let stripped = trimmed.replace(/[\.…]+\s*$/, "");
  const patterns = [
    /\s+(?:part|cour)\s+\d+.*$/i,
    /\s*-\s*(?:part|cour)\s+\d+.*$/i,
    /\s+(?:season|\b\d+(?:st|nd|rd|th)\s+season)\s*.*$/i,
    /\s*-\s*(?:season|\b\d+(?:st|nd|rd|th)\s+season)\s*.*$/i,
    /\s*\((?:season|\b\d+(?:st|nd|rd|th)\s+season)\s*.*\)$/i,
    /\s*-\s*[^:]+$/i,
  ];

  for (const pat of patterns) {
    const next = stripped.replace(pat, "").trim();
    if (next && next.length >= 2 && next !== stripped) {
      candidates.add(next);
      stripped = next;
    }
  }

  if (trimmed.includes(":")) {
    const beforeColon = trimmed.split(":")[0].trim();
    if (beforeColon && beforeColon.length >= 3) {
      candidates.add(beforeColon);
    }
  }

  return Array.from(candidates);
}

function cleanBaseTitle(title) {
  if (!title || typeof title !== "string") return "";
  return title
    .replace(/[\.…]+\s*$/, "")
    .replace(/\s+(?:season|\b\d+(?:st|nd|rd|th)\s+season|part|cour)\s*.*$/i, "")
    .replace(
      /\s*-\s*(?:season|\b\d+(?:st|nd|rd|th)\s+season|part|cour)\s*.*$/i,
      "",
    )
    .replace(
      /\s*\((?:season|\b\d+(?:st|nd|rd|th)\s+season|tv|part|cour)\s*.*\)$/i,
      "",
    )
    .trim();
}

async function resolvePosterImage(uuid, title, fallbackImage) {
  const db = getExtensionDatabase();
  if (db) {
    try {
      const row = await db
        .prepare("SELECT malid FROM pahe WHERE uuid = ? OR id = ? LIMIT 1")
        .get(uuid, uuid);
      let malid = row?.malid;
      if (
        !malid &&
        (uuid === "858fa643-262f-5c07-d80f-28dece13d592" ||
          (title && title.toLowerCase() === "one piece"))
      ) {
        malid = 21;
      }

      if (!malid && title) {
        try {
          const candidates = generateNormalizedTitleCandidates(title);
          for (const cand of candidates) {
            const tRow = await db
              .prepare(
                "SELECT malid, image_url FROM anime WHERE LOWER(TRIM(title)) = ? LIMIT 1",
              )
              .get(cand.toLowerCase());
            if (tRow?.malid) {
              malid = tRow.malid;
              if (tRow.image_url) {
                return { image: tRow.image_url, malid };
              }
              break;
            }
          }

          if (!malid) {
            const baseClean = cleanBaseTitle(title);
            if (baseClean && baseClean.length >= 4) {
              let orderSql = "ORDER BY LENGTH(title) ASC";
              if (/\b(?:season\s*2|2nd\s*season)\b/i.test(title)) {
                orderSql =
                  "ORDER BY CASE WHEN title LIKE '%2%' OR title LIKE '%Season 2%' THEN 0 ELSE 1 END, LENGTH(title) ASC";
              }
              const likeRow = await db
                .prepare(
                  `SELECT malid, image_url FROM anime WHERE title LIKE ? ${orderSql} LIMIT 1`,
                )
                .get(`${baseClean}%`);
              if (likeRow?.malid) {
                malid = likeRow.malid;
                if (likeRow.image_url) {
                  return { image: likeRow.image_url, malid };
                }
              }
            }
          }
        } catch (_) {}
      }

      if (malid) {
        const aRow = await db
          .prepare("SELECT image_url FROM anime WHERE malid = ? LIMIT 1")
          .get(malid);
        if (aRow?.image_url) {
          return { image: aRow.image_url, malid };
        }
      }

      if (uuid || title) {
        const uRow = await db
          .prepare(
            "SELECT image_url FROM unmapped_items WHERE (id = ? OR name = ?) AND image_url IS NOT NULL AND image_url != '' LIMIT 1",
          )
          .get(uuid || "", title || "");
        if (uRow?.image_url) {
          return { image: uRow.image_url, malid: null };
        }
      }
    } catch (_) {}
  }
  return { image: fallbackImage || "/images/image-404.png", malid: null };
}

// Recent Episodes
async function fetchRecentEpisodes(filters = {}) {
  const pageNum = filters.page || 1;

  if (pageNum === 1) {
    let html = "";
    if (typeof global.scrapperFetch === "function") {
      try {
        html = await global.scrapperFetch(`${baseUrl}/`);
      } catch (_) {}
    }
    if (!html) {
      try {
        const baseRes = await safeGet(
          `${baseUrl}/`,
          {
            headers: {
              Cookie: "",
              Referer: `${baseUrl}/`,
            },
            skipCookie: true,
          },
          1,
        );
        html = typeof baseRes?.data === "string" ? baseRes.data : "";
      } catch (_) {}
    }

    if (html) {
      const parsed = parseRecentEpisodesFromHtml(html);
      if (parsed.length > 0) {
        console.log(
          `[AnimePahe] Successfully parsed ${parsed.length} latest releases from base URL homepage`,
        );
        const enrichedParsed = await Promise.all(
          parsed.map(async (item) => {
            const permId = await resolvePaheId(item.id);
            const { image, malid } = await resolvePosterImage(
              item.id,
              item.title,
              item.image,
            );
            return {
              ...item,
              id: permId || item.id,
              image: image || item.image,
              snapshot: item.image,
              malid,
            };
          }),
        );
        return {
          currentPage: 1,
          hasNextPage: true,
          totalPages: 100,
          results: enrichedParsed,
        };
      }
    }
  }

  let data = null;
  try {
    const apiRes = await safeGet(
      `${baseUrl}/api?m=airing&page=${pageNum}`,
      {
        headers: {
          Referer: baseUrl + "/",
        },
      },
      2,
      { expectJson: true },
    );
    data = apiRes?.data;
  } catch (err) {
    console.warn(`[AnimePahe] /api?m=airing failed (${err.message})`);
  }

  const enrichedResults = await Promise.all(
    (data?.data || []).map(async (item) => {
      const permId =
        (item.anime_id ? String(item.anime_id) : null) ||
        (await resolvePaheId(item.anime_session));
      const { image, malid } = await resolvePosterImage(
        item.anime_session,
        item.anime_title,
        item?.snapshot,
      );
      return {
        id: permId || `${item.anime_session}`,
        title: item.anime_title,
        image: image || item?.snapshot,
        snapshot: item?.snapshot,
        episode: item.episode,
        malid,
      };
    }),
  );

  const res = {
    currentPage: pageNum,
    hasNextPage: data?.next_page_url?.length > 0 ? true : false,
    totalPages: data?.last_page ?? 0,
    results: enrichedResults,
  };
  return res;
}

// Animeinfo
async function AnimeInfo(id) {
  const cleanId = String(id).trim();
  const targetUuid = await resolvePaheUuid(cleanId);
  const animeInfo = {
    id: cleanId,
    title: "",
  };

  try {
    const res = await safeGet(`${baseUrl}/anime/${targetUuid}`, {
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
    if (MalId) {
      const db = getExtensionDatabase();
      if (db) {
        try {
          await db
            .prepare(
              "INSERT INTO pahe (id, uuid, malid) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET uuid = excluded.uuid, malid = excluded.malid",
            )
            .run(cleanId, targetUuid, MalId);
        } catch (_) {}
      }
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
      .map((_, el) => $(el).find("a").attr("title"))
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

    const seasonText = $('div.col-sm-4.anime-info p:icontains("Season:") a')
      .text()
      .trim();
    const seasonMatch = seasonText.match(
      /(Winter|Spring|Summer|Fall)\s*(\d{4})/i,
    );
    if (seasonMatch) {
      animeInfo.season = seasonMatch[1].toUpperCase();
      animeInfo.year = parseInt(seasonMatch[2], 10);
    }

    const epText = $('div.col-sm-4.anime-info p:icontains("Episodes:")')
      .text()
      .replace(/Episodes:\s*/i, "")
      .trim();
    const epNum = parseInt(epText, 10);
    if (!isNaN(epNum)) {
      animeInfo.episodes = epNum;
    }

    animeInfo.studio =
      $('div.col-sm-4.anime-info p:icontains("Studio:") a').text().trim() ||
      null;

    animeInfo.duration =
      $('div.col-sm-4.anime-info p:icontains("Duration:")')
        .text()
        .replace(/Duration:\s*/i, "")
        .trim() || null;

    animeInfo.dataId = cleanId;
    animeInfo.uuid = targetUuid;

    return animeInfo;
  } catch (error) {
    const is404 =
      error?.status === 404 ||
      error?.response?.status === 404 ||
      error?.message?.includes("404");

    if (is404 && targetUuid) {
      console.warn(
        `[AnimePahe] UUID ${targetUuid} (ID: ${cleanId}) returned 404. Checking canary and directory to auto-heal UUID...`,
      );

      // Fast check: if this broken UUID belongs to One Piece and we already have a newer canary UUID
      const savedOpUuid = await getSavedOnePieceUuid();
      if (
        savedOpUuid &&
        String(targetUuid).toLowerCase() !== savedOpUuid.toLowerCase()
      ) {
        if (
          cleanId === "4" ||
          targetUuid === "858fa643-262f-5c07-d80f-28dece13d592"
        ) {
          console.log(
            `[AnimePahe] Auto-healing broken One Piece UUID ${targetUuid} -> ${savedOpUuid} via saved canary UUID`,
          );
          return {
            needsMappingSync: true,
            brokenUuid: targetUuid,
            newUuid: savedOpUuid,
            dataId: cleanId,
            version: null,
          };
        }
      }

      notifyRenderer("info-loading-status", {
        text: "Auto-healing AnimePahe UUID from directory, please wait...",
      });
      let resolvedNewUuid = null;
      let resolvedVersion = null;
      try {
        const syncResult = await syncPaheDirectory(targetUuid);
        if (syncResult?.resolvedNewUuid) {
          resolvedNewUuid = syncResult.resolvedNewUuid;
          resolvedVersion = syncResult.version;
          console.log(
            `[AnimePahe] Server auto-healed UUID ${targetUuid} -> ${resolvedNewUuid}`,
          );
          const db = getExtensionDatabase();
          if (db) {
            try {
              await db
                .prepare(
                  "INSERT INTO pahe (id, uuid) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET uuid = excluded.uuid",
                )
                .run(cleanId, resolvedNewUuid);
            } catch (_) {}
          }
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
          brokenUuid: targetUuid,
          newUuid: resolvedNewUuid,
          dataId: cleanId,
          version: resolvedVersion || null,
        };
      } else {
        return {
          needsMappingSync: false,
          brokenUuid: targetUuid,
          newUuid: null,
          dataId: cleanId,
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
  const targetUuid = await resolvePaheUuid(id);
  if (firstEpCache[targetUuid] !== undefined) {
    return firstEpCache[targetUuid];
  }
  try {
    const { data } = await safeGet(
      `${baseUrl}/api?m=release&id=${targetUuid}&sort=episode_desc&page=${lastPage}`,
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
      firstEpCache[targetUuid] = firstEp;
      return firstEp;
    }
  } catch (err) {
    console.error("Failed to fetch first episode number:", err);
  }
  firstEpCache[targetUuid] = 1;
  return 1;
}

// Fetching Episodes Pages
async function fetchEpisode(id, page = 1) {
  try {
    const targetUuid = await resolvePaheUuid(id);
    let episodes = [];
    const resp = await safeGet(
      `${baseUrl}/api?m=release&id=${targetUuid}&sort=episode_desc&page=${page}`,
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

    const firstEpNum = await getFirstEpisodeNumber(targetUuid, last_page);
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
    let targetEpisodeId = episodeId;
    if (episodeId && episodeId.includes("/")) {
      const [animePart, epPart] = episodeId.split("/");
      const resolvedAnimeUuid = await resolvePaheUuid(animePart);
      targetEpisodeId = `${resolvedAnimeUuid}/${epPart}`;
    }
    const { data } = await safeGet(`${baseUrl}/play/${targetEpisodeId}`, {
      headers: {
        Referer: baseUrl,
      },
    });
    const $ = (0, cheerio.load)(data);

    let linksArray = $("div#resolutionMenu > button")
      .map((_, el) => ({
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
        if (typeof global.registerSubrequestHeaders === "function") {
          global.registerSubrequestHeaders(streamDomain, {
            Referer: playerReferer,
          });
        }
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

function isPageLoaded(_, html) {
  if (!html || typeof html !== "string") return false;
  const lower = html.toLowerCase();
  return (
    lower.includes("latest releases") ||
    lower.includes("beware of fake websites") ||
    lower.includes("episode-wrap") ||
    (lower.includes("/anime/") && lower.includes("navbar-brand")) ||
    lower.includes('class="anime-summary"') ||
    lower.includes('class="the-content"')
  );
}

async function healId({ oldId, malid, title }) {
  if (!oldId) return null;
  const cleanOldId = String(oldId).trim();

  let resolvedMalId = malid ? Number(malid) : null;

  const db = getExtensionDatabase();
  if (db) {
    try {
      let mappingRow = null;
      if (resolvedMalId) {
        mappingRow = await db
          .prepare("SELECT uuid FROM pahe WHERE malid = ? LIMIT 1")
          .get(resolvedMalId);
      } else {
        mappingRow = await db
          .prepare("SELECT uuid FROM pahe WHERE id = ? OR uuid = ? LIMIT 1")
          .get(cleanOldId, cleanOldId);
      }
      if (
        mappingRow?.uuid &&
        mappingRow.uuid.toLowerCase() !== cleanOldId.toLowerCase()
      ) {
        return mappingRow.uuid;
      }
    } catch (_) {}

    try {
      const unmappedRow = await db
        .prepare(
          "SELECT id, name FROM unmapped_items WHERE provider = 'pahe' AND (id = ? OR LOWER(TRIM(name)) = ?) LIMIT 1",
        )
        .get(cleanOldId, (title || "").toLowerCase().trim());
      if (
        unmappedRow?.id &&
        unmappedRow.id.toLowerCase() !== cleanOldId.toLowerCase()
      ) {
        return unmappedRow.id;
      }
    } catch (_) {}
  }

  if (title) {
    try {
      const sRes = await SearchAnime(title);
      const sResults = sRes?.results || (Array.isArray(sRes) ? sRes : []);
      if (sResults.length > 0) {
        const exact =
          sResults.find(
            (s) =>
              (s.title || "").toLowerCase().trim() ===
              String(title).toLowerCase().trim(),
          ) || sResults[0];
        if (
          exact &&
          exact.id &&
          String(exact.id).toLowerCase() !== cleanOldId.toLowerCase()
        ) {
          const newUuid = String(exact.id).toLowerCase().trim();
          if (db) {
            try {
              await db
                .prepare(
                  "UPDATE unmapped_items SET id = ?, image_url = COALESCE(?, image_url) WHERE provider = 'pahe' AND (id = ? OR LOWER(TRIM(name)) = ?)",
                )
                .run(
                  newUuid,
                  exact.image || exact.image_url || null,
                  cleanOldId,
                  String(title).toLowerCase().trim(),
                );
            } catch (_) {}
          }
          return newUuid;
        }
      }
    } catch (e) {
      console.warn("[AnimePahe] healId SearchAnime error:", e.message);
    }
  }

  if (
    resolvedMalId === 21 ||
    (title && /^one piece$/i.test(String(title).trim()))
  ) {
    const savedOpUuid = await getSavedOnePieceUuid();
    if (savedOpUuid && savedOpUuid.toLowerCase() !== cleanOldId.toLowerCase()) {
      return savedOpUuid;
    }
  }

  notifyRenderer("info-loading-status", {
    text: "Auto-healing AnimePahe UUID from directory, please wait...",
  });
  try {
    const syncResult = await syncPaheDirectory(cleanOldId);
    if (
      syncResult?.resolvedNewUuid &&
      syncResult.resolvedNewUuid.toLowerCase() !== cleanOldId.toLowerCase()
    ) {
      return syncResult.resolvedNewUuid;
    }
  } catch (err) {
    console.error("[AnimePahe] Failed to heal UUID:", err.message);
  } finally {
    notifyRenderer("info-loading-status", { text: "" });
  }

  return null;
}

async function checkCanary(canaryData) {
  const expectedOnePieceUuid =
    typeof canaryData === "object"
      ? canaryData?.onePieceUuid
      : typeof canaryData === "string"
        ? canaryData
        : null;
  if (!expectedOnePieceUuid) return;
  console.log(
    `[AnimePahe] Server requested canary check. Expected One Piece UUID: ${expectedOnePieceUuid}`,
  );

  let html = "";
  if (typeof global.scrapperFetch === "function") {
    try {
      html = await global.scrapperFetch(`${baseUrl}/anime`);
    } catch (_) {}
  }
  if (!html) {
    try {
      const res = await safeGet(`${baseUrl}/anime`, { skipBypass: true }, 2);
      html = typeof res?.data === "string" ? res.data : "";
    } catch (err) {
      console.warn(`[AnimePahe] Canary check fetch failed: ${err.message}`);
      return;
    }
  }

  if (!html) return;

  const opRegex =
    /<a\s+[^>]*href="\/anime\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let currentOpUuid = null;
  while ((m = opRegex.exec(html)) !== null) {
    const u = m[1].toLowerCase().trim();
    const n = (m[2] || "")
      .replace(/<[^>]+>/g, "")
      .replace(/[\r\n\t]+/g, " ")
      .trim();
    if (n.toLowerCase() === "one piece") {
      currentOpUuid = u;
      break;
    }
  }

  const client = global.axios || require("axios");

  if (
    currentOpUuid &&
    currentOpUuid === expectedOnePieceUuid.toLowerCase().trim()
  ) {
    console.log(
      `[AnimePahe] One Piece canary verified unchanged (${currentOpUuid}). Reporting to server...`,
    );
    await setSavedSetting("pahe_one_piece_uuid", currentOpUuid);
    try {
      await client.post(
        "https://strawverse.theyogmehta.online/api/pahe/canary",
        {
          onePieceUuid: currentOpUuid,
          rotated: false,
        },
        { timeout: 15000 },
      );
    } catch (postErr) {
      console.warn(
        `[AnimePahe] Failed to report canary status to server: ${postErr.message}`,
      );
    }
  } else if (currentOpUuid) {
    console.log(
      `[AnimePahe] One Piece canary ROTATION detected (${expectedOnePieceUuid} -> ${currentOpUuid}). Synchronizing catalog with mapping server...`,
    );
    const syncRes = await syncPaheDirectory(null, html, true);
    if (syncRes && !syncRes.skipped) {
      console.log(
        `[AnimePahe] Catalog successfully uploaded to server (version: ${syncRes.version || "updated"}). Downloading updated mapping from server...`,
      );
      if (typeof global.checkForMappingUpdates === "function") {
        try {
          await global.checkForMappingUpdates(true);
        } catch (_) {}
      }
    }
  }
}

async function onInfoFetched({ id, info, api }) {
  if (!id || !info || !api) return;
  try {
    let parsedMalId =
      info?.malid || info?.MalID ? Number(info.malid || info.MalID) : null;

    if (!parsedMalId && info.title) {
      try {
        const db = getExtensionDatabase();
        if (db) {
          const candidates = generateNormalizedTitleCandidates(info.title);
          for (const cand of candidates) {
            const tRow = await db
              .prepare(
                "SELECT malid FROM anime WHERE LOWER(TRIM(title)) = ? LIMIT 1",
              )
              .get(cand.toLowerCase());
            if (tRow?.malid) {
              parsedMalId = Number(tRow.malid);
              break;
            }
          }
        }
      } catch (_) {}
    }

    const isMapped = (await api.isMapped(id)) || !!parsedMalId;

    if (!isMapped) {
      // Unmapped series: persist metadata in mapping.db and report to server
      if (typeof api.saveUnmapped === "function") {
        await api.saveUnmapped({
          id,
          name: info.title || "Unknown",
          image_url: info.image || null,
          type: info.type || "TV",
          episodes: info.episodes ? String(info.episodes) : null,
          status: info.status || "Unknown",
          season: info.season || null,
          year: info.year ? parseInt(info.year, 10) : null,
        });
      }
    } else {
      // Mapped series: ensure cleaned from unmapped items
      if (typeof api.deleteUnmapped === "function") {
        await api.deleteUnmapped(id);
      }
    }

    if (parsedMalId && typeof api.getMappedMalId === "function") {
      const currentMalId = await api.getMappedMalId(id);
      if (
        currentMalId !== parsedMalId &&
        typeof api.reportMapping === "function"
      ) {
        await api.reportMapping({
          uuid: info.uuid || (isValidPaheUuid(id) ? id : null),
          id: info.dataId ? String(info.dataId) : String(id),
          malid: parsedMalId,
          name: info.title || null,
        });
      }
    }
  } catch (_) {}
}

module.exports = {
  name: "pahe",
  version: "7.0.2",
  baseUrl,
  headerRules: [
    {
      match: ["animepahe", "anipixcdn"],
      headers: { Referer: "https://animepahe.pw/" },
    },
    {
      match: ["owocdn", "uwucdn", "kwik"],
      headers: { Referer: "https://kwik.cx/" },
    },
  ],
  MappingRules: [
    {
      source: "info",
      fields: [
        "title",
        "image",
        "type",
        "description",
        "genres",
        "status",
        "season",
        "year",
        "episodes",
        "aired",
        "studio",
        "duration",
      ],
      extractMalId: (info) => {
        if (!info) return null;
        if (info.malid) return info.malid;
        if (typeof info.aniSearch === "string") {
          const match = info.aniSearch.match(/myanimelist\.net\/anime\/(\d+)/i);
          if (match) return parseInt(match[1], 10);
        }
        return null;
      },
    },
  ],
  subrequestHeaders: [
    {
      match: ["owocdn", "uwucdn", "kwik"],
      headers: { Referer: "https://kwik.cx/" },
    },
  ],
  bypassDomains: ["animepahe", "kwik.cx"],
  cookieDomains: [
    "animepahe.pw",
    "animepahe.com",
    "animepahe.org",
    "anipixcdn",
  ],
  domainAliases: {
    "owocdn.top": "kwik.cx",
    "uwucdn.top": "kwik.cx",
  },
  isPageLoaded,
  healId,
  checkCanary,
  onInfoFetched,
  SearchAnime,
  AnimeInfo,
  fetchEpisodeSources,
  processServer,
  fetchRecentEpisodes,
  fetchEpisode,
};

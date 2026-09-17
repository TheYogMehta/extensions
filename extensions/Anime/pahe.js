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
const baseUrl = "https://animepahe.pw";

function notifyRenderer(channel, payload) {
  if (typeof global.sendToRenderer === "function") {
    try {
      global.sendToRenderer(channel, payload);
    } catch (_) {}
  }
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500;

async function safeGet(url, config = {}, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_REQUEST_INTERVAL) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLast),
      );
    }
    lastRequestTime = Date.now();

    const isApi = url.includes("/api?");
    const mergedHeaders = {
      Referer: baseUrl + "/",
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
      const response = await global.axios.get(url, reqConfig);
      let data = response?.data;

      if (isApi && typeof data === "string") {
        try {
          data = JSON.parse(data);
          response.data = data;
        } catch (_) {}
      }

      const isRateLimited =
        response?.status === 429 ||
        data?.status === 429 ||
        data?.error_code === 1015 ||
        data?.title?.includes("rate limited") ||
        (typeof data === "string" &&
          (data.includes("error code: 1015") || data.includes("rate limited")));

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
          continue;
        }
      }

      notifyRenderer("catalog-loading-status", {
        text: "",
      });
      return response;
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        notifyRenderer("catalog-loading-status", { text: "" });
        throw err;
      }
      if (status === 403 && attempt < maxRetries) {
        console.warn(
          `[AnimePahe] HTTP 403 on attempt ${attempt}/${maxRetries}. Checking clearance...`,
        );
        try {
          if (global.cloudflarebypass) {
            await global.cloudflarebypass(url, false, baseUrl + "/");
          }
        } catch (_) {}
      }
      if (attempt < maxRetries) {
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

      throw err;
    }
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
  const { data } = await safeGet(`${baseUrl}/api?m=airing&page=${pageNum}`, {
    headers: {
      Referer: baseUrl,
    },
  });
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
    animeInfo.title = $("div.title-wrapper > h1 > span").first().text();
    let image = $("div.anime-poster a").attr("href") ?? null;
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
        let html = "";
        if (typeof global.scrapperFetch === "function") {
          try {
            html = await global.scrapperFetch(`${baseUrl}/anime`);
          } catch (_) {}
        }
        if (!html) {
          const catalogRes = await safeGet(`${baseUrl}/anime`);
          html = typeof catalogRes?.data === "string" ? catalogRes.data : "";
        }

        let links = [];
        let tsv = "";
        if (html) {
          try {
            const $ = (0, cheerio.load)(html);
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
            let match;
            while ((match = linkRegex.exec(html)) !== null) {
              const u = match[1].toLowerCase().trim();
              const n = match[2]
                .replace(/<[^>]*>/g, "")
                .replace(/[\r\n\t]+/g, " ")
                .trim();
              if (u && n) {
                links.push({ uuid: u, name: n });
                tsv += `${u}\t${n}\n`;
              }
            }
          }
        }

        if (links.length > 0 && global.axios) {
          const syncRes = await global.axios
            .post(
              "https://strawverse.theyogmehta.online/api/pahe/index",
              { brokenUuid: id, catalog: tsv, links },
              { timeout: 30000 },
            )
            .catch((err) => {
              console.error(
                "[AnimePahe] Failed to post index to server:",
                err?.message,
              );
              return null;
            });
          if (syncRes?.data?.resolvedNewUuid) {
            resolvedNewUuid = syncRes.data.resolvedNewUuid;
            console.log(
              `[AnimePahe] Server auto-healed UUID ${id} -> ${resolvedNewUuid}`,
            );
          }
          if (syncRes?.data?.version) {
            resolvedVersion = syncRes.data.version;
          }
        }
      } catch (recoveryErr) {
        console.error(
          "[AnimePahe] Failed to recover from /anime index:",
          recoveryErr.message,
        );
        notifyRenderer("info-loading-status", {
          text: "",
        });
      }

      notifyRenderer("info-loading-status", {
        text: "Updating database with healed mapping, please wait...",
      });

      return {
        needsMappingSync: true,
        brokenUuid: id,
        newUuid: resolvedNewUuid || null,
        dataId: resolvedNewUuid || id,
        version: resolvedVersion || null,
      };
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
async function extract(videoUrl, retries = 2, delay = 1000) {
  let sources = [];
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await global.axios.get(videoUrl.href, {
        headers: {
          Referer: "https://animepahe.pw/",
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
      if (
        (err.response?.status === 429 || err.message.includes("429")) &&
        attempt < retries
      ) {
        console.warn(
          `Request to ${videoUrl.href} returned 429. Retrying in ${delay}ms (attempt ${attempt}/${retries})...`,
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
  version: "5.0.1",
  SearchAnime,
  AnimeInfo,
  fetchEpisodeSources,
  processServer,
  fetchRecentEpisodes,
  fetchEpisode,
};

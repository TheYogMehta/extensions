/**
 * StrawVerse Extension - Comix Scraper
 * Copyright (C) 2026 TheYogMehta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * DISCLAIMER: This extension is intended for research, educational,
 * and developer testing purposes only.
 */

const axios = require("axios");
const cheerio = require("cheerio");

const baseUrl = "https://comix.to";

let apicoreCache = null;
let apicoreCacheTime = 0;
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

async function getComixCore() {
  const now = Date.now();
  if (apicoreCache && now - apicoreCacheTime < CACHE_TTL) {
    return apicoreCache;
  }

  const client = global.axios || axios;
  const browseRes = await client.get(`${baseUrl}/browse`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  const mainMatch = browseRes.data.match(/src="([^"]*main-towkub-[^"]*\.js)"/);
  if (!mainMatch) {
    throw new Error("Could not find main bundle script on comix.to");
  }
  const mainUrl = new URL(mainMatch[1], baseUrl).href;

  const mainRes = await client.get(mainUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  const apicoreMatch = mainRes.data.match(/from"([^"]*apicore-towkub-[^"]*\.js)"/);
  if (!apicoreMatch) {
    throw new Error("Could not find apicore bundle script on comix.to");
  }
  const apicoreUrl = new URL(apicoreMatch[1], mainUrl).href;

  const apicoreRes = await client.get(apicoreUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  let js = apicoreRes.data;
  const helperCode = `
var Gq=Object.create,Hq=Object.defineProperty,Iq=Object.getOwnPropertyDescriptor,Jq=Object.getOwnPropertyNames,Kq=Object.getPrototypeOf,Lq=Object.prototype.hasOwnProperty;
var UB=(a,b)=>()=>(b||(a((b={"exports":{}}).exports,b),a=null),b.exports);
var UZ=(a,b)=>{let c={};for(var d in a)Hq(c,d,{"get":a[d],"enumerable":!0});return b||Hq(c,Symbol.toStringTag,{"value":"Module"}),c};
var UO=(a,b,c)=>(c=null!=a?Gq(Kq(a)):{},((a,b,c,d)=>{if(b&&"object"==typeof b||"function"==typeof b)for(var h,e=Jq(b),f=0,g=e.length;f<g;f++)h=e[f],Lq.call(a,h)||h===c||Hq(a,h,{"get":(a=>b[a]).bind(null,h),"enumerable":!(d=Iq(b,h))||d.enumerable});return a})(!b&&a&&a.__esModule?c:Hq(c,"default",{"value":a,"enumerable":!0}),a));
`;
  js = js.replace(/import\{n as UZ,r as UO,t as UB\}from"[^"]+";/, helperCode);
  js = js.replace(/export\{[^}]+\};?$/, "\nreturn { ql, fk };");

  const mockStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const mockWindow = {
    location: { host: "comix.to", hostname: "comix.to", href: "https://comix.to/browse" },
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: mockStorage,
    sessionStorage: mockStorage,
  };
  const mockDocument = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementsByTagName: () => [],
  };
  const mockNavigator = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const btoa = (s) => Buffer.from(s, "binary").toString("base64");
  const atob = (s) => Buffer.from(s, "base64").toString("binary");
  class CustomEvent {}

  const runner = new Function(
    "window",
    "document",
    "navigator",
    "btoa",
    "atob",
    "CustomEvent",
    "localStorage",
    "sessionStorage",
    "setInterval",
    "clearInterval",
    "setTimeout",
    "clearTimeout",
    js
  );

  const resCore = runner(
    mockWindow,
    mockDocument,
    mockNavigator,
    btoa,
    atob,
    CustomEvent,
    mockStorage,
    mockStorage,
    () => {},
    () => {},
    () => {},
    () => {}
  );

  apicoreCache = {
    ql: resCore.ql,
    fk: resCore.fk,
  };
  apicoreCacheTime = now;
  return apicoreCache;
}

async function requestComixApi(apiPath, params = {}, referer = `${baseUrl}/browse`) {
  const client = global.axios || axios;
  let core = await getComixCore();

  const makeReq = async () => {
    const token = core.ql(apiPath, params);
    const qs = new URLSearchParams();

    function appendParam(prefix, value) {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (const item of value) {
          qs.append(`${prefix}[]`, item);
        }
      } else if (typeof value === "object") {
        for (const k of Object.keys(value)) {
          appendParam(`${prefix}[${k}]`, value[k]);
        }
      } else {
        qs.append(prefix, value);
      }
    }

    for (const k of Object.keys(params)) {
      if (k === "_") continue;
      appendParam(k, params[k]);
    }
    if (token) {
      qs.append("_", token);
    }

    const queryStr = qs.toString();
    const url = `${baseUrl}/api/v1${apiPath}${queryStr ? `?${queryStr}` : ""}`;

    const headers = {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      priority: "u=1, i",
      "x-requested-with": "XMLHttpRequest",
      "x-rt": "0",
      referer: referer,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };

    const res = await client.get(url, { headers });
    let resData = res.data;
    if (
      res.headers["x-enc"] === "2" ||
      (resData && typeof resData === "object" && resData.e && typeof resData.e === "string")
    ) {
      try {
        resData = core.fk.ij(resData.e);
      } catch (decErr) {}
    }
    return resData;
  };

  try {
    return await makeReq();
  } catch (err) {
    if (err.response?.status === 403 && err.response?.data?.code === "missing_token") {
      apicoreCache = null;
      core = await getComixCore();
      return await makeReq();
    }
    throw err;
  }
}

async function latestManga(page = 1) {
  try {
    const data = await requestComixApi(
      "/manga",
      {
        order: { chapter_updated_at: "desc" },
        page: page,
        limit: 28,
      },
      `${baseUrl}/browse`
    );

    const items = data?.result?.items || data?.items || [];
    const results = items.map((item) => {
      const slug = (item.title || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const id = item.url
        ? item.url.replace(/^\/title\//, "")
        : `${item.hid || item.id}-${slug}`;
      let image = item.poster?.medium || item.poster?.large || null;
      if (image && image.startsWith("/")) {
        image = `${baseUrl}${image}`;
      }
      return {
        id: id,
        title: item.title,
        image: image || null,
      };
    });

    return {
      current_page: page,
      hasNextPage: data?.result?.meta?.hasNext ?? results.length > 0,
      results: results,
    };
  } catch (err) {
    const client = global.axios || axios;
    const { data } = await client.get(`${baseUrl}/`);
    const $ = cheerio.load(data);
    const raw = $("#initial-data").html();
    if (!raw) return { current_page: page, hasNextPage: false, results: [] };

    const parsed = JSON.parse(raw);
    let items = [];

    for (const k of Object.keys(parsed.queries || {})) {
      if (
        k.includes('"manga"') &&
        (k.includes('"list"') || k.includes('"top"'))
      ) {
        const q = parsed.queries[k];
        const list = Array.isArray(q) ? q : q.items || q.data || [];
        if (Array.isArray(list) && list.length > 0) {
          items = list;
          break;
        }
      }
    }

    const results = items.map((item) => {
      const slug = (item.title || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const id = `${item.hid || item.id}-${slug}`;
      let image = item.poster?.medium || item.poster?.large || null;
      if (image && image.startsWith("/")) {
        image = `${baseUrl}${image}`;
      }
      return {
        id: id,
        title: item.title,
        image: image || null,
      };
    });

    return {
      current_page: page,
      hasNextPage: results.length > 0,
      results: results,
    };
  }
}

async function searchManga(query, page = 1) {
  try {
    if (!query) return latestManga(page);

    const data = await requestComixApi(
      "/manga",
      {
        order: { relevance: "desc" },
        page: page,
        limit: 28,
        content_rating: ["safe", "suggestive"],
        keyword: query,
      },
      `${baseUrl}/browse?q=${encodeURIComponent(query)}&sort=relevance:desc`
    );

    const items = data?.result?.items || data?.items || [];
    const results = items.map((item) => {
      const slug = (item.title || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const id = item.url
        ? item.url.replace(/^\/title\//, "")
        : `${item.hid || item.id}-${slug}`;
      let image = item.poster?.medium || item.poster?.large || null;
      if (image && image.startsWith("/")) {
        image = `${baseUrl}${image}`;
      }
      return {
        id: id,
        title: item.title,
        image: image || null,
      };
    });

    return {
      current_page: page,
      hasNextPage: data?.result?.meta?.hasNext ?? results.length > 0,
      results: results,
    };
  } catch (err) {
    throw err;
  }
}

async function fetchMangaInfo(mangaId) {
  try {
    if (mangaId.startsWith("md-")) {
      const realId = mangaId.replace("md-", "");
      const { data } = await (global.axios || axios).get(
        `https://api.mangadex.org/manga/${realId}?includes[]=cover_art&includes[]=author`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        }
      );
      const m = data?.data;
      const titleObj = m?.attributes?.title || {};
      const title = titleObj.en || Object.values(titleObj)[0] || "";
      const description = m?.attributes?.description?.en || "";
      const rels = m?.relationships || [];
      const fileName = rels.find((r) => r.type === "cover_art")?.attributes
        ?.fileName;
      const image = fileName
        ? `https://uploads.mangadex.org/covers/${realId}/${fileName}`
        : null;
      const author =
        rels.find((r) => r.type === "author")?.attributes?.name || "";
      const genres = (m?.attributes?.tags || [])
        .map((t) => t.attributes?.name?.en)
        .filter(Boolean);

      return {
        id: mangaId,
        title,
        image,
        description,
        genres,
        author,
        type: "Manga",
        released: String(m?.attributes?.year || ""),
        year: m?.attributes?.year ? parseInt(m.attributes.year, 10) : null,
        status: m?.attributes?.status || "Ongoing",
      };
    }

    const hid = mangaId.includes("-") ? mangaId.split("-")[0] : mangaId;
    try {
      const data = await requestComixApi(
        `/manga/${hid}`,
        {},
        `${baseUrl}/title/${mangaId}`
      );
      const detail = data?.result || data;
      if (detail && detail.title) {
        let image = detail.poster?.large || detail.poster?.medium || null;
        if (image && image.startsWith("/")) {
          image = `${baseUrl}${image}`;
        }
        const genres = (detail.genres || []).map(
          (g) => g.name || g.label || g.title || g
        );
        const authors = (detail.authors || [])
          .map((a) => a.name || a.label || a)
          .join(", ");

        return {
          id: mangaId,
          title: detail.title || "",
          image: image,
          description: detail.synopsis || "",
          genres: genres,
          author: authors,
          type: detail.type || "Comic",
          released: detail.year ? String(detail.year) : "",
          year: detail.year ? parseInt(detail.year, 10) : null,
          status: detail.status || "Ongoing",
        };
      }
    } catch (_) {}

    const { data } = await (global.axios || axios).get(`${baseUrl}/title/${mangaId}`);
    const $ = cheerio.load(data);
    const raw = $("#initial-data").html();
    if (!raw) throw new Error("Manga not found");

    const parsed = JSON.parse(raw);
    let detail = null;
    for (const k of Object.keys(parsed.queries || {})) {
      if (k.includes('"manga"') && k.includes('"detail"')) {
        detail = parsed.queries[k];
        break;
      }
    }

    if (!detail) throw new Error("Manga detail not found");

    let image = detail.poster?.large || detail.poster?.medium || null;
    if (image && image.startsWith("/")) {
      image = `${baseUrl}${image}`;
    }

    const genres = (detail.genres || []).map((g) => g.name || g.title || g);
    const authors = (detail.authors || []).map((a) => a.name || a).join(", ");

    return {
      id: mangaId,
      title: detail.title || "",
      image: image,
      description: detail.synopsis || "",
      genres: genres,
      author: authors,
      type: detail.type || "Comic",
      released: detail.year ? String(detail.year) : "",
      year: detail.year ? parseInt(detail.year, 10) : null,
      status: detail.status || "Ongoing",
    };
  } catch (err) {
    throw err;
  }
}

async function fetchChapters(mangaId, page = 1) {
  try {
    if (mangaId.startsWith("md-")) {
      const realId = mangaId.replace("md-", "");
      const { data } = await (global.axios || axios).get(
        `https://api.mangadex.org/manga/${realId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        }
      );
      const chapters = (data?.data || []).map((ch) => ({
        id: `mdch-${ch.id}`,
        number: parseFloat(ch.attributes?.chapter) || 0,
      }));

      return {
        TotalPages: 1,
        total: chapters.length,
        Chapters: chapters,
      };
    }

    const hid = mangaId.includes("-") ? mangaId.split("-")[0] : mangaId;
    const targetPage = page ? parseInt(page, 10) : 1;

    try {
      const data = await requestComixApi(
        `/manga/${hid}/chapters`,
        { limit: 100, page: targetPage },
        `${baseUrl}/title/${mangaId}`
      );
      const result = data?.result || data;
      const items = result?.items || [];
      if (items.length > 0) {
        const en = items.filter((c) => !c.language || c.language === "en");
        const list = en.length > 0 ? en : items;
        const chapters = list.map((ch) => ({
          id: String(ch.id),
          number: parseFloat(ch.number) || 0,
          title: ch.name || (ch.number ? `Chapter ${ch.number}` : ""),
        }));

        return {
          TotalPages: result?.meta?.lastPage || 1,
          total: result?.meta?.total || chapters.length,
          Chapters: chapters,
        };
      }
    } catch (_) {}

    // Fallback to MangaDex if comix chapters endpoint is unavailable/captcha-blocked
    let mdId = null;
    try {
      const { data } = await (global.axios || axios).get(`${baseUrl}/title/${mangaId}`);
      const $ = cheerio.load(data);
      const raw = $("#initial-data").html();
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k of Object.keys(parsed.queries || {})) {
          if (k.includes('"manga"') && k.includes('"detail"')) {
            const detail = parsed.queries[k];
            const mdUrl = detail.links?.md;
            if (mdUrl && mdUrl.includes("/title/")) {
              mdId = mdUrl.split("/title/")[1].split("/")[0];
            }
            break;
          }
        }
      }
    } catch (_) {}

    if (mdId) {
      const { data } = await (global.axios || axios).get(
        `https://api.mangadex.org/manga/${mdId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        }
      );
      const chapters = (data?.data || []).map((ch) => ({
        id: `mdch-${ch.id}`,
        number: parseFloat(ch.attributes?.chapter) || 0,
      }));

      return {
        TotalPages: 1,
        total: chapters.length,
        Chapters: chapters,
      };
    }

    return { TotalPages: 0, total: 0, Chapters: [] };
  } catch (err) {
    return { TotalPages: 0, total: 0, Chapters: [] };
  }
}

async function fetchChapterPages(chapterId) {
  try {
    if (String(chapterId).startsWith("mdch-")) {
      const realChId = String(chapterId).replace("mdch-", "");
      const { data } = await (global.axios || axios).get(
        `https://api.mangadex.org/at-home/server/${realChId}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        }
      );
      const serverBase = data.baseUrl;
      const hash = data.chapter?.hash;
      const files = data.chapter?.data || [];

      return files.map((file, idx) => ({
        page: idx + 1,
        img: `${serverBase}/data/${hash}/${file}`,
      }));
    }

    const data = await requestComixApi(
      `/chapters/${chapterId}`,
      {},
      `${baseUrl}`
    );
    const result = data?.result || data;
    const items = result?.pages?.items || [];
    return items.map((file, idx) => ({
      page: idx + 1,
      img: file.url,
    }));
  } catch (err) {
    return [];
  }
}

module.exports = {
  name: "comix",
  version: "3.1.0",
  MinAppVersion: "11.1.0",
  baseUrl,
  headerRules: [
    {
      match: ["comix", ".site", "kkplayer.wtf"],
      strip: ["Referer", "referer", "Origin", "origin"],
    },
  ],
  bypassDomains: ["comix"],
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
};

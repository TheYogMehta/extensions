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

const cheerio = require("cheerio");

const baseUrl = "https://comix.to";

async function latestManga(page = 1) {
  try {
    const { data } = await global.axios.get(`${baseUrl}/`);
    const $ = cheerio.load(data);
    const raw = $("#initial-data").html();
    if (!raw) return { current_page: page, hasNextPage: false, results: [] };

    const parsed = JSON.parse(raw);
    let items = [];

    for (const k of Object.keys(parsed.queries || {})) {
      if (k.includes('"manga"') && (k.includes('"list"') || k.includes('"top"'))) {
        const q = parsed.queries[k];
        const list = Array.isArray(q) ? q : (q.items || q.data || []);
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
      const image = item.poster?.medium || item.poster?.large || null;
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
  } catch (err) {
    throw err;
  }
}

async function searchManga(query, page = 1) {
  try {
    if (!query) return latestManga(page);

    const { data } = await global.axios.get(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=30`,
    );
    const results = (data?.data || []).map((m) => {
      const titleObj = m.attributes?.title || {};
      const title = titleObj.en || Object.values(titleObj)[0] || "Unknown";
      const rels = m.relationships || [];
      const fileName = rels.find((r) => r.type === "cover_art")?.attributes
        ?.fileName;
      const image = fileName
        ? `https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`
        : null;

      return {
        id: `md-${m.id}`,
        title: title,
        image: image || null,
      };
    });

    return {
      current_page: page,
      hasNextPage: results.length > 0,
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
      const { data } = await global.axios.get(
        `https://api.mangadex.org/manga/${realId}?includes[]=cover_art&includes[]=author`,
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
        status: m?.attributes?.status || "Ongoing",
      };
    }

    const { data } = await global.axios.get(`${baseUrl}/title/${mangaId}`);
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

    const image = detail.poster?.large || detail.poster?.medium || null;

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
      status: detail.status || "Ongoing",
    };
  } catch (err) {
    throw err;
  }
}

async function fetchChapters(mangaId) {
  try {
    let mdId = null;

    if (mangaId.startsWith("md-")) {
      mdId = mangaId.replace("md-", "");
    } else {
      const { data } = await global.axios.get(`${baseUrl}/title/${mangaId}`);
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
    }

    if (mdId) {
      const { data } = await global.axios.get(
        `https://api.mangadex.org/manga/${mdId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500`,
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
    if (chapterId.startsWith("mdch-")) {
      const realChId = chapterId.replace("mdch-", "");
      const { data } = await global.axios.get(
        `https://api.mangadex.org/at-home/server/${realChId}`,
      );
      const serverBase = data.baseUrl;
      const hash = data.chapter?.hash;
      const files = data.chapter?.data || [];

      return files.map((file, idx) => ({
        page: idx + 1,
        img: `${serverBase}/data/${hash}/${file}`,
      }));
    }

    return [];
  } catch (err) {
    return [];
  }
}

module.exports = {
  name: "comix",
  version: "1.0.0",
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
};

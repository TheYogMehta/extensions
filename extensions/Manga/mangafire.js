/**
 * StrawVerse Extension - MangaFire Scraper
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

const baseUrl = "https://mangafire.to";

async function latestManga(page = 1) {
  try {
    const limit = 30;
    const offset = (page - 1) * limit;
    const { data } = await global.axios.get(
      `https://api.mangadex.org/manga?limit=${limit}&offset=${offset}&includes[]=cover_art&order[updatedAt]=desc`,
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
        id: `mf-${m.id}`,
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

async function searchManga(query, page = 1) {
  try {
    if (!query) return latestManga(page);

    const limit = 30;
    const offset = (page - 1) * limit;
    const { data } = await global.axios.get(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&includes[]=cover_art`,
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
        id: `mf-${m.id}`,
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
    const realId = mangaId.replace("mf-", "");
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
  } catch (err) {
    throw err;
  }
}

async function fetchChapters(mangaId) {
  try {
    const realId = mangaId.replace("mf-", "");
    const contentRatings =
      "&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic";
    let res = await global.axios.get(
      `https://api.mangadex.org/manga/${realId}/feed?translatedLanguage[]=en${contentRatings}&order[chapter]=desc&limit=500`,
    );
    let data = res.data;
    if (!data?.data || data.data.length === 0) {
      res = await global.axios.get(
        `https://api.mangadex.org/manga/${realId}/feed?${contentRatings.slice(1)}&order[chapter]=desc&limit=500`,
      );
      data = res.data;
    }
    const chapters = (data?.data || []).map((ch) => ({
      id: `mfch-${ch.id}`,
      number: parseFloat(ch.attributes?.chapter) || 0,
      title: ch.attributes?.title || `Chapter ${ch.attributes?.chapter || ""}`,
    }));

    return {
      TotalPages: 1,
      total: chapters.length,
      Chapters: chapters,
    };
  } catch (err) {
    return { TotalPages: 0, total: 0, Chapters: [] };
  }
}

async function fetchChapterPages(chapterId) {
  try {
    const realChId = chapterId.replace("mfch-", "");
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
  } catch (err) {
    return [];
  }
}

module.exports = {
  name: "mangafire",
  version: "1.0.0",
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
};

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

async function latestManga(page = 1, filters = {}) {
  try {
    const limit = 30;
    const offset = (page - 1) * limit;
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      "includes[]": "cover_art",
    });
    applyMangaFilters(params, filters, true);
    const { data } = await global.axios.get(
      `https://api.mangadex.org/manga?${params.toString()}`,
    );

    const results = mapMangaResults(data);
    const total = data?.total ?? offset + results.length;

    return {
      current_page: page,
      hasNextPage: offset + results.length < total,
      results: results,
    };
  } catch (err) {
    throw err;
  }
}

async function searchManga(query, page = 1, filters = {}) {
  try {
    if (!query) return latestManga(page, filters);

    const limit = 30;
    const offset = (page - 1) * limit;
    const params = new URLSearchParams({
      title: query,
      limit: String(limit),
      offset: String(offset),
      "includes[]": "cover_art",
    });
    applyMangaFilters(params, filters, false);
    const { data } = await global.axios.get(
      `https://api.mangadex.org/manga?${params.toString()}`,
    );

    const results = mapMangaResults(data);
    const total = data?.total ?? offset + results.length;

    return {
      current_page: page,
      hasNextPage: offset + results.length < total,
      results: results,
    };
  } catch (err) {
    throw err;
  }
}

// Maps Discover filters (genre/status/sort) onto MangaDex API params.
// genre = MangaDex tag UUID, status = ongoing|completed|hiatus|cancelled,
// sort = latest-updated|most-followed|rating|title-az.
function applyMangaFilters(params, filters = {}, isDiscover = false) {
  const genreIds = resolveGenreIds(filters?.genre);
  for (const gid of genreIds) {
    params.append("includedTags[]", gid);
  }

  const status = String(filters?.status || "")
    .trim()
    .toLowerCase();
  if (["ongoing", "completed", "hiatus", "cancelled"].includes(status)) {
    params.append("status[]", status);
  }

  const sort = String(filters?.sort || "").trim();
  if (sort === "most-followed") {
    params.append("order[followedCount]", "desc");
  } else if (sort === "rating") {
    params.append("order[rating]", "desc");
  } else if (sort === "title-az") {
    params.append("order[title]", "asc");
  } else if (isDiscover) {
    params.append("order[updatedAt]", "desc");
  }
}

function resolveGenreIds(genre) {
  if (genre === undefined || genre === null || genre === "") return [];
  const list = Array.isArray(genre) ? genre : String(genre).split(",");
  return list.map((g) => String(g).trim()).filter(Boolean);
}

function mapMangaResults(data) {
  return (data?.data || []).map((m) => {
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
  version: "1.0.2",
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
};

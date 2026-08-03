/**
 * StrawVerse Extension - Asura Scans Scraper
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

const baseUrl = "https://asurascans.com";

async function latestManga(page = 1) {
  try {
    const { data } = await global.axios.get(`${baseUrl}/browse?page=${page}`);
    const $ = cheerio.load(data);
    const results = [];

    $("a[href*='/comics/']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      const parts = href.split("/comics/");
      if (parts.length < 2) return;
      const id = parts[1].split("/")[0].split("?")[0];
      if (!id) return;

      const imgEl = $(el).find("img");
      const image = imgEl.attr("src") || imgEl.attr("data-src") || null;
      let title = $(el).text().trim();

      // Clean rating numbers or extra text from title if present
      title = title.replace(/^[\d.]+\s*/, "").trim();

      if (title && image && !results.some((r) => r.id === id)) {
        results.push({
          id: id,
          title: title,
          image: image,
        });
      }
    });

    let totalPages = null;
    const bodyText = $("body").text();
    const match =
      bodyText.match(/Browse\s*Series\s*(\d+)/i) ||
      bodyText.match(/Series\s*(\d+)/i);
    if (match) {
      const totalSeries = parseInt(match[1], 10);
      totalPages = Math.ceil(totalSeries / (results.length || 20));
    }

    return {
      current_page: page,
      totalPages: totalPages,
      hasNextPage: totalPages ? page < totalPages : results.length > 0,
      results: results,
    };
  } catch (err) {
    throw err;
  }
}

async function searchManga(query, page = 1) {
  try {
    const { data } = await global.axios.get(
      `${baseUrl}/comics?name=${encodeURIComponent(query)}`,
    );
    const $ = cheerio.load(data);
    const results = [];

    $("a[href*='/comics/']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      const parts = href.split("/comics/");
      if (parts.length < 2) return;
      const id = parts[1].split("/")[0].split("?")[0];
      if (!id) return;

      const imgEl = $(el).find("img");
      const image = imgEl.attr("src") || imgEl.attr("data-src") || null;
      let title = $(el)
        .text()
        .trim()
        .replace(/^[\d.]+\s*/, "")
        .trim();

      const qLower = (query || "").toLowerCase();
      if (
        title &&
        image &&
        (!qLower || title.toLowerCase().includes(qLower)) &&
        !results.some((r) => r.id === id)
      ) {
        results.push({
          id: id,
          title: title,
          image: image,
        });
      }
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
    const { data } = await global.axios.get(`${baseUrl}/comics/${mangaId}`);
    const $ = cheerio.load(data);

    const title = $("h1").first().text().trim() || "";
    const imageRaw =
      $("img[src*='covers']").first().attr("src") ||
      $("img[src*='asura-images']").first().attr("src") ||
      $("img").first().attr("src") ||
      "";
    const image = imageRaw || null;

    const description =
      $("span.font-medium.text-sm").first().text().trim() ||
      $(".description, .synopsis, p").first().text().trim() ||
      "";

    const genres = [];
    $("button:contains('Genre'), a[href*='genre']").each((_, el) => {
      const genre = $(el).text().trim();
      if (genre && !genres.includes(genre)) genres.push(genre);
    });

    let status = "Ongoing";
    let author = "";
    let type = "Manhwa";
    let released = "";

    $("div, p, span").each((_, el) => {
      const text = $(el).text().trim();
      if (text.startsWith("Status")) {
        status = text.replace("Status", "").trim();
      } else if (text.startsWith("Author")) {
        author = text.replace("Author", "").trim();
      } else if (text.startsWith("Type")) {
        type = text.replace("Type", "").trim();
      } else if (text.startsWith("Released")) {
        released = text.replace("Released", "").trim();
      }
    });

    return {
      id: mangaId,
      title,
      image,
      description,
      genres,
      author,
      type,
      released,
      status,
    };
  } catch (err) {
    throw err;
  }
}

async function fetchChapters(mangaId) {
  try {
    const { data } = await global.axios.get(`${baseUrl}/comics/${mangaId}`);
    const $ = cheerio.load(data);
    const chapters = [];

    $("a[href*='/chapter/']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      let chapId = href;
      if (href.startsWith("/")) chapId = href.slice(1);
      if (chapId.startsWith("comics/")) chapId = chapId.replace("comics/", "");

      const text = $(el).text().trim();
      const numMatch =
        text.match(/chapter\s*([\d.]+)/i) || href.match(/chapter\/([\d.]+)/i);
      const number = numMatch ? parseFloat(numMatch[1]) : 0;

      if (!chapters.some((c) => c.id === chapId)) {
        chapters.push({
          id: chapId,
          number: number,
        });
      }
    });

    return {
      TotalPages: 1,
      total: chapters.length,
      Chapters: chapters,
    };
  } catch (err) {
    return {
      TotalPages: 0,
      total: 0,
      Chapters: [],
    };
  }
}

async function fetchChapterPages(chapterId) {
  try {
    let url = chapterId.startsWith("http")
      ? chapterId
      : `${baseUrl}/comics/${chapterId}`;

    const { data } = await global.axios.get(url);
    const $ = cheerio.load(data);
    const pages = [];

    $("img[src*='/asura-images/chapters/']").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      if (src && !pages.some((p) => p.img === src)) {
        pages.push({
          page: pages.length + 1,
          img: src,
        });
      }
    });

    return pages;
  } catch (err) {
    return [];
  }
}

module.exports = {
  name: "asurascans",
  version: "1.0.1",
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
};

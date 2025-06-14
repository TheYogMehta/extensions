const cheerio = require("cheerio");
const axios = require("axios");
const baseUrl = "https://weebcentral.com";

async function latestManga(page = 1) {
  try {
    const { data } = await axios.get(`${baseUrl}/latest-updates/${page}`);
    const $ = cheerio.load(data);

    const latestMangas = [];

    $("article").each((index, article) => {
      const Manga = $(article);
      let id = Manga.find("a").attr("href");
      if (id?.includes("/series/")) {
        id = id.split("/series/")?.[1].split("/")?.[0];
        if (id) {
          const image = Manga.find("picture > img")?.attr("src") ?? null;
          const title =
            Manga.find(".font-semibold.text-lg")
              ?.text()
              ?.replaceAll("\n", "")
              ?.trim() ?? null;

          if (image && title) {
            latestMangas.push({
              id: id,
              title: title,
              image: image,
            });
          }
        }
      }
    });

    return {
      current_page: page,
      hasNextPage: $("button[hx-get]").length > 0,
      results: latestMangas,
    };
  } catch (err) {
    throw err;
  }
}

async function searchManga(query, page = 1) {
  try {
    const offset = (page - 1) * 32;

    const { data } = await axios.get(
      `${baseUrl}/search/data?limit=32&offset=${offset}&text=${encodeURIComponent(
        query
      )}&sort=Best+Match&order=Ascending&official=Any&anime=Any&adult=Any&display_mode=Full+Display`
    );

    const $ = cheerio.load(data);

    const results = [];

    $("body article").each((index, article) => {
      const Manga = $(article).find("section").eq(0);
      if (Manga.length > 0) {
        let id = Manga.find("a").attr("href");
        if (id?.includes("/series/")) {
          id = id.split("/series/")?.[1].split("/")?.[0];
          if (id) {
            const MangaArticle = Manga?.find("article")?.eq(1);
            if (MangaArticle?.length > 0) {
              const image = MangaArticle?.find("picture > img")?.attr("src");
              const title = MangaArticle?.find(".text-ellipsis")
                ?.first()
                ?.text()
                ?.replaceAll("\n", "")
                ?.trim();

              if (title && image) {
                results.push({
                  id: id,
                  title: title,
                  image: image,
                });
              }
            }
          }
        }
      }
    });

    return {
      current_page: page,
      hasNextPage: $("button[hx-get]").length > 0,
      results: results,
    };
  } catch (err) {
    throw err;
  }
}

async function fetchMangaInfo(mangaId) {
  try {
    let mangaInfo = {
      id: mangaId,
      genres: [],
      type: "",
      author: "",
      released: "",
    };

    const { data } = await axios.get(`${baseUrl}/series/${mangaId}`);
    const $ = cheerio.load(data);
    const Main = $("main > div > section");

    if (Main.length > 0) {
      const LeftSections = Main.find("section");

      // left section
      mangaInfo.title = LeftSections.find("h1")
        .eq(0)
        ?.text()
        ?.trim()
        ?.toLowerCase();
      mangaInfo.image = LeftSections.find("picture > img").attr("src");
      // extra info
      LeftSections.find("section")
        .eq(2)
        .find("ul")
        .find("li")
        .each((index, li) => {
          let strongTag = $(li)
            .find("strong")
            .text()
            .trim()
            .replace(":", "")
            .replace("(s)", "")
            .toLowerCase();

          if (strongTag === "tags") strongTag = "genres";

          if (mangaInfo.hasOwnProperty(strongTag)) {
            let value = $(li)
              .find("a, span")
              .map((i, el) => $(el).text().trim().replace(/,$/, ""))
              .get();

            value = [...new Set(value)].filter((v) => v !== "");

            mangaInfo[strongTag] = Array.isArray(mangaInfo[strongTag])
              ? value
              : value[0];
          }
        });

      // Right section
      const RightSections = Main.eq(0).children("section").eq(1);

      const descriptionSection = RightSections.find(
        "li:has(strong:contains('Description')) p"
      );

      mangaInfo.description = descriptionSection.length
        ? descriptionSection.text().trim()
        : null;
    }

    return mangaInfo;
  } catch (err) {
    throw err;
  }
}

async function fetchChapters(mangaId) {
  try {
    const { data } = await axios.get(
      `${baseUrl}/series/${mangaId}/full-chapter-list`
    );
    const $ = cheerio.load(data);

    let chapterLinks = [];
    const divs = $("div").toArray();

    for (
      let i = divs.length - 1, chapterNumber = 1;
      i >= 0;
      i--, chapterNumber++
    ) {
      const aTag = $(divs[i]).find("a").first();
      const href = aTag.attr("href");

      if (href) {
        let id = href.split("/chapters/")[1];
        if (id) {
          chapterLinks.push({
            id: id,
            number: chapterNumber,
          });
        }
      }
    }

    if (chapterLinks?.length > 0) {
      chapterLinks.reverse();
    }

    return {
      TotalPages: 1,
      total: chapterLinks?.length ?? 0,
      Chapters: chapterLinks,
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
    const { data } = await axios.get(
      `${baseUrl}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`
    );
    const $ = cheerio.load(data);

    const pages = $("img")
      .map((index, img) => ({
        page: index + 1,
        img: `${$(img).attr("src")}`,
      }))
      .get();

    return pages;
  } catch (err) {
    return [];
  }
}

module.exports = {
  name: "weebcentral",
  version: "1.0.0",
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
};

const cheerio = require("cheerio");
const baseUrl = "https://comix.to";

let scrapeWithBypass = async (url) => {
  let electron;
  try {
    electron = require("electron");
  } catch (e) {
    throw new Error("Electron is required for comix captcha bypass");
  }

  const { BrowserWindow } = electron;
  return new Promise((resolve, reject) => {
    let win = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    let resolved = false;

    win.on('closed', () => {
      if (!resolved) {
        reject(new Error("Window closed before extracting data"));
      }
    });

    win.webContents.on('did-finish-load', async () => {
      try {
        const title = await win.webContents.executeJavaScript('document.title');
        if (title.includes('Just a moment')) {
          // It's Cloudflare challenge, wait for it to solve
          win.show();
          return;
        }

        win.hide();

        const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
        resolved = true;
        win.close();
        resolve(html);
      } catch (err) {
        resolved = true;
        win.close();
        reject(err);
      }
    });

    win.loadURL(url);
  });
};

async function latestManga(page = 1) {
  if (typeof page === "object") {
    page = page.page || 1;
  }
  try {
    const html = await scrapeWithBypass(
      `${baseUrl}/browse?sort=chapter_updated_at&page=${page}`
    );
    const $ = cheerio.load(html);

    const latestMangas = [];

    $(".lrow").each((index, article) => {
      const Manga = $(article);
      let href = Manga.find(".lrow__title-link").attr("href");
      if (href && href.includes("/title/")) {
        let id = href.split("/title/")[1];
        if (id) {
          const image = Manga.find("img")?.attr("src") ?? null;
          const title = Manga.find(".lrow__title")?.text()?.trim() ?? null;

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
      hasNextPage: true,
      results: latestMangas,
    };
  } catch (err) {
    throw err;
  }
}

async function searchManga(query, page = 1) {
  if (typeof page === "object") {
    page = page.page || 1;
  }
  try {
    const html = await scrapeWithBypass(
      `${baseUrl}/browse?keyword=${encodeURIComponent(query)}&page=${page}`
    );
    const $ = cheerio.load(html);

    const results = [];

    $(".lrow").each((index, article) => {
      const Manga = $(article);
      let href = Manga.find(".lrow__title-link").attr("href");
      if (href && href.includes("/title/")) {
        let id = href.split("/title/")[1];
        if (id) {
          const image = Manga.find("img")?.attr("src") ?? null;
          const title = Manga.find(".lrow__title")?.text()?.trim() ?? null;

          if (image && title) {
            results.push({
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
      hasNextPage: results.length > 0,
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
      title: "",
      image: "",
      description: "",
      genres: [],
      type: "",
      author: "",
      released: "",
    };

    const html = await scrapeWithBypass(`${baseUrl}/title/${mangaId}`);
    const $ = cheerio.load(html);

    mangaInfo.title = $(".mpage__title").text().trim() || $("h1").text().trim();
    mangaInfo.image =
      $(".mpage__poster img").attr("src") || $("picture img").attr("src");
    mangaInfo.description =
      $(".mpage__desc").text().trim() || $("article.mpage__article").text().trim();

    $(".mpage__chip").each((i, el) => {
      mangaInfo.genres.push($(el).text().trim());
    });

    $(".mpage__detail").each((i, el) => {
      const label = $(el).find(".mpage__detail-label").text().trim().toLowerCase();
      const value = $(el).find(".mpage__detail-items").text().trim();
      if (label.includes("type")) mangaInfo.type = value;
      if (label.includes("author")) mangaInfo.author = value;
      if (label.includes("status")) mangaInfo.released = value;
    });

    return mangaInfo;
  } catch (err) {
    throw err;
  }
}

async function fetchChapters(mangaId) {
  try {
    const html = await scrapeWithBypass(`${baseUrl}/title/${mangaId}`);
    const $ = cheerio.load(html);

    let chapterLinks = [];
    const elements = $(".mchap-row__primary").toArray();

    for (let i = 0; i < elements.length; i++) {
      const href = $(elements[i]).attr("href");
      if (href) {
        let id = href.split("/title/")[1];
        if (id) {
          let numStr = id.split("-chapter-")[1];
          let num = parseFloat(numStr) || elements.length - i;
          chapterLinks.push({
            id: id,
            number: num,
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
    const html = await scrapeWithBypass(`${baseUrl}/title/${chapterId}`);
    const $ = cheerio.load(html);

    const pages = $(".rpage-page__img")
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
  name: "comix",
  version: "1.0.1",
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
};

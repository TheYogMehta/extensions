const crypto = require("crypto");
const cheerio = require("cheerio");
const axios = require("axios").create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://allmanga.to/",
  },
});

const apiUrl = "https://api.allanime.day/api";
const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
let activeBypassPromise = null;
let lastBypassTime = 0;

function getImageUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${THUMBNAIL_CDN}${url}?w=250`;
}

function decryptTobeparsed(blob) {
  try {
    const buf = Buffer.from(blob, "base64");
    const iv = buf.slice(1, 13);
    const cipher = buf.slice(13, buf.length - 16);
    const key = crypto.createHash("sha256").update("Xot36i3lK3:v1").digest();
    const ivHex = iv.toString("hex") + "00000002";
    const decipher = crypto.createDecipheriv(
      "aes-256-ctr",
      key,
      Buffer.from(ivHex, "hex"),
    );
    let dec = decipher.update(cipher, null, "utf8") + decipher.final("utf8");
    return JSON.parse(dec);
  } catch (e) {
    return null;
  }
}

function findPictureUrls(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = findPictureUrls(item);
      if (res) return res;
    }
  } else {
    if (obj.pictureUrls && Array.isArray(obj.pictureUrls)) {
      return obj;
    }
    for (const key of Object.keys(obj)) {
      const res = findPictureUrls(obj[key]);
      if (res) return res;
    }
  }
  return null;
}

function decryptJSON(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => decryptJSON(item));
  } else {
    const newObj = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (
        typeof val === "string" &&
        val.length > 50 &&
        !val.includes(" ") &&
        !val.startsWith("http")
      ) {
        const decrypted = decryptTobeparsed(val);
        if (decrypted) {
          console.log(`CDP: Successfully decrypted key "${key}"!`);
          newObj[key] = decryptJSON(decrypted);
          continue;
        }
      }
      newObj[key] = decryptJSON(val);
    }
    return newObj;
  }
}

let ensureCloudflareBypassed = async (force = false) => {
  if (!global.ScrapperWindow) {
    throw new Error("Global ScrapperWindow is not initialized");
  }

  const win = global.ScrapperWindow;

  const currentCookies = await win.webContents.session.cookies
    .get({})
    .catch(() => []);
  const hasClearance = currentCookies.some((c) => c.name === "cf_clearance");

  if (hasClearance && !force && Date.now() - lastBypassTime < 1000 * 60 * 10) {
    const cookieString = currentCookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    return cookieString;
  }

  if (activeBypassPromise) {
    return activeBypassPromise;
  }

  activeBypassPromise = (async () => {
    global.IsBypassingCloudflare = true;

    try {
      await win.loadURL("https://allmanga.to/");

      let passed = false;
      for (let i = 0; i < 60; i++) {
        const title = await win.webContents
          .executeJavaScript("document.title")
          .catch(() => "");
        const isNuxt = await win.webContents
          .executeJavaScript("!!window.__NUXT__")
          .catch(() => false);

        if (
          isNuxt ||
          title.toLowerCase().includes("allmanga") ||
          title.toLowerCase().includes("allanime")
        ) {
          passed = true;
          break;
        } else if (title) {
          if (!global.ScrapperWindow.isVisible()) win.show();
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!passed) {
        win.hide();
        throw new Error("Timeout waiting for Cloudflare captcha");
      }

      win.hide();
      lastBypassTime = Date.now();

      const cookies = await win.webContents.session.cookies.get({});
      const cookieString = cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      return cookieString;
    } finally {
      global.IsBypassingCloudflare = false;
      activeBypassPromise = null;
    }
  })();

  return activeBypassPromise;
};

let fetchWithCaptchaBypass = async (gql, variables) => {
  let cookieString = await ensureCloudflareBypassed();

  let res;
  try {
    res = await axios.post(
      apiUrl,
      {
        query: gql,
        variables: variables,
      },
      {
        headers: {
          Cookie: cookieString,
        },
      },
    );
  } catch (err) {
    if (
      err.response &&
      err.response.data &&
      err.response.data.errors &&
      err.response.data.errors.some((e) => e.message === "NEED_CAPTCHA")
    ) {
      res = err.response;
    } else {
      throw err;
    }
  }

  let data = res?.data;

  if (data?.errors && data.errors.some((e) => e.message === "NEED_CAPTCHA")) {
    cookieString = await ensureCloudflareBypassed(true);

    const retryRes = await axios.post(
      apiUrl,
      {
        query: gql,
        variables: variables,
      },
      {
        headers: {
          Cookie: cookieString,
        },
      },
    );
    data = retryRes.data;
  }

  if (data?.errors && data.errors.some((e) => e.message === "NEED_CAPTCHA")) {
    throw new Error("NEED_CAPTCHA still returned despite bypass");
  }

  return data;
};

async function latestManga(page = 1) {
  return searchManga("", page);
}

async function searchManga(query, page = 1) {
  try {
    const gql = `query(
      $search: SearchInput
      $page: Int
      $translationType: VaildTranslationTypeMangaEnumType
      $countryOrigin: VaildCountryOriginEnumType
    ) {
      mangas(
        search: $search
        page: $page
        translationType: $translationType
        countryOrigin: $countryOrigin
      ) {
        edges {
          _id
          name
          thumbnail
        }
      }
    }`;

    const data = await fetchWithCaptchaBypass(gql, {
      search: {
        query: query || "",
        isManga: true,
        allowAdult: false,
        allowUnknown: false,
      },
      page: page,
      translationType: "sub",
      countryOrigin: "ALL",
    });

    const edges = data?.data?.mangas?.edges || [];
    const results = edges.map((m) => ({
      id: m._id,
      title: m.name,
      image: getImageUrl(m.thumbnail),
    }));

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
    const gql = `query ($id: String!) {
      manga(_id: $id) {
        _id
        name
        thumbnail
        description
        authors
        genres
        tags
        status
        altNames
        englishName
      }
    }`;

    const data = await fetchWithCaptchaBypass(gql, { id: mangaId });

    const m = data?.data?.manga;
    if (!m) throw new Error("Manga not found");

    return {
      id: m._id,
      title: m.name,
      image: getImageUrl(m.thumbnail),
      description: m.description || "",
      genres: m.genres || [],
      author: m.authors ? m.authors.join(", ") : "",
      type: "Manga",
      released: "",
      status: m.status || "",
    };
  } catch (err) {
    throw err;
  }
}

async function fetchChapters(mangaId) {
  try {
    const gql = `query ($id: String!) {
      manga(_id: $id) {
        _id
        availableChaptersDetail
      }
    }`;

    const data = await fetchWithCaptchaBypass(gql, { id: mangaId });

    const availableChaptersDetail = data?.data?.manga?.availableChaptersDetail;
    let chapters = [];
    if (availableChaptersDetail && availableChaptersDetail.sub) {
      const subChapters = availableChaptersDetail.sub;
      for (const ch of subChapters) {
        chapters.push({
          id: `${mangaId}_${ch}`,
          number: parseFloat(ch) || 0,
        });
      }
    } else if (availableChaptersDetail && availableChaptersDetail.raw) {
      const rawChapters = availableChaptersDetail.raw;
      for (const ch of rawChapters) {
        chapters.push({
          id: `${mangaId}_${ch}`,
          number: parseFloat(ch) || 0,
        });
      }
    }

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
  global.IsBypassingCloudflare = true;

  let win = null;
  let dbg = null;
  let onMessage = null;

  try {
    let mangaId = "";
    let chapterString = chapterId;
    if (chapterId.includes("_")) {
      const parts = chapterId.split("_");
      mangaId = parts[0];
      chapterString = parts[1];
    } else {
      throw new Error(
        "Invalid chapterId format for allmanga. Expected mangaId_chapterString",
      );
    }

    if (!global.ScrapperWindow) {
      throw new Error("Global ScrapperWindow is not initialized");
    }

    win = global.ScrapperWindow;
    const url = `https://allmanga.to/manga/${mangaId}/chapter-${chapterString}-sub`;

    dbg = win.webContents.debugger;
    let capturedPages = null;
    const apiRequests = new Set();

    onMessage = async (event, method, params) => {
      if (method === "Network.responseReceived") {
        const { url } = params.response;
        if (
          url.includes("api.allanime.day") ||
          url.includes("/api") ||
          url.includes("allmanga")
        ) {
          apiRequests.add(params.requestId);
        }
      } else if (method === "Network.loadingFinished") {
        if (apiRequests.has(params.requestId)) {
          try {
            const bodyRes = await dbg.sendCommand("Network.getResponseBody", {
              requestId: params.requestId,
            });
            if (bodyRes && bodyRes.body) {
              let data = JSON.parse(bodyRes.body);
              data = decryptJSON(data);
              const found = findPictureUrls(data);
              if (found) {
                capturedPages = data;
              }
            }
          } catch (e) {
            // ignore
          }
        }
      }
    };

    try {
      if (!dbg.isAttached()) {
        await win.loadURL("about:blank");
        dbg.attach("1.1");
        await dbg.sendCommand("Network.enable");
      }
      dbg.on("message", onMessage);
    } catch (e) {
      console.error("CDP setup failed:", e);
    }

    await win.loadURL(url);

    let passed = false;
    for (let i = 0; i < 60; i++) {
      const title = await win.webContents
        .executeJavaScript("document.title")
        .catch(() => "");
      const isNuxt = await win.webContents
        .executeJavaScript("!!window.__NUXT__")
        .catch(() => false);

      if (
        isNuxt ||
        title.toLowerCase().includes("allmanga") ||
        title.toLowerCase().includes("allanime")
      ) {
        passed = true;
        break;
      } else if (title) {
        if (!global.ScrapperWindow.isVisible()) win.show();
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!passed) {
      win.hide();
      return [];
    }

    win.hide();

    for (let k = 0; k < 12; k++) {
      if (capturedPages) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    let edges = [];
    if (capturedPages) {
      const match = findPictureUrls(capturedPages);
      if (match) {
        edges = [match];
      }
    }

    if (edges.length === 0) {
      await win.webContents
        .executeJavaScript(
          `
        (async () => {
          for (let i = 0; i < 20; i++) {
            window.scrollTo(0, i * 1500);
            await new Promise(r => setTimeout(r, 50));
          }
        })()
      `,
        )
        .catch(() => {});

      let imagesLoaded = false;
      for (let j = 0; j < 30; j++) {
        const imgCount = await win.webContents
          .executeJavaScript(
            `
          Array.from(document.querySelectorAll('img')).filter(img => {
            const src = img.getAttribute('data-src') || img.getAttribute('src');
            if (!src) return false;
            if (
              src.includes('logo') ||
              src.includes('avatar') ||
              src.includes('discord') ||
              src.includes('icon') ||
              src.includes('banner') ||
              src.includes('mcovers') ||
              src.includes('/cover/') ||
              src.includes('widget')
            ) {
              return false;
            }
            return (
              src.includes('youtube-anime') ||
              src.includes('allanime') ||
              src.includes('allmanga') ||
              src.startsWith('/') ||
              src.includes('/images') ||
              src.includes('/all/manga/')
            );
          }).length
        `,
          )
          .catch(() => 0);

        if (imgCount > 0) {
          imagesLoaded = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      const html = await win.webContents
        .executeJavaScript("document.documentElement.outerHTML")
        .catch(() => "");

      const regex = /"tobeparsed":"([^"]+)"/g;
      let matchBlob;
      while ((matchBlob = regex.exec(html)) !== null) {
        const decrypted = decryptTobeparsed(matchBlob[1]);
        if (decrypted) {
          if (
            decrypted.chapterPages &&
            decrypted.chapterPages.edges &&
            decrypted.chapterPages.edges.length > 0
          ) {
            edges = decrypted.chapterPages.edges;
            break;
          }
          if (
            decrypted.chaptersForRead &&
            decrypted.chaptersForRead.edges &&
            decrypted.chaptersForRead.edges.length > 0
          ) {
            edges = decrypted.chaptersForRead.edges;
            break;
          }
        }
      }
      if (edges.length === 0) {
        const $ = cheerio.load(html);
        const imgs = [];
        $("img").each((i, el) => {
          const src = $(el).attr("data-src") || $(el).attr("src");
          if (src) {
            if (
              src.includes("logo") ||
              src.includes("avatar") ||
              src.includes("discord") ||
              src.includes("icon") ||
              src.includes("banner") ||
              src.includes("mcovers") ||
              src.includes("/cover/") ||
              src.includes("widget")
            ) {
              return;
            }

            const isMangaDomain =
              src.includes("youtube-anime.com") ||
              src.includes("allanime") ||
              src.includes("allmanga") ||
              src.startsWith("/") ||
              src.includes("/images") ||
              src.includes("/all/manga/");

            if (isMangaDomain) {
              imgs.push({ url: src });
            }
          }
        });
        if (imgs.length > 0) {
          edges = [{ pictureUrls: imgs }];
        }
      }
    }

    const pages = [];
    if (edges && edges.length > 0) {
      const edge = edges[0];
      const pictureUrls = edge.pictureUrls || [];
      for (let i = 0; i < pictureUrls.length; i++) {
        let url = pictureUrls[i].url;
        if (!url) continue;
        if (!url.startsWith("http")) {
          let head = edge.pictureUrlHead || "https://ytimgf.youtube-anime.com/";
          if (head && !head.endsWith("/")) head += "/";
          url = head + (url.startsWith("/") ? url.slice(1) : url);
        }
        pages.push({
          page: i + 1,
          img: url,
        });
      }
    }

    return pages;
  } catch (err) {
    console.error("fetchChapterPages error:", err);
    return [];
  } finally {
    if (dbg && onMessage) {
      dbg.off("message", onMessage);
      try {
        dbg.detach();
      } catch (e) {}
    }
    global.IsBypassingCloudflare = false;
  }
}

async function getHeaders() {
  const cookieString = await ensureCloudflareBypassed();
  return {
    Referer: "https://allmanga.to/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Cookie: cookieString,
  };
}

module.exports = {
  name: "allmanga",
  version: "1.0.0",
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
  getHeaders,
};

const axios = require("axios").create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://allmanga.to/",
  },
});
const crypto = require("crypto");

const apiUrl = "https://api.allanime.day/api";
const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";

function getImageUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${THUMBNAIL_CDN}${url}?w=250`;
}

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

    const { data } = await axios.post(apiUrl, {
      query: gql,
      variables: {
        search: {
          query: query || "",
          isManga: true,
          allowAdult: false,
          allowUnknown: false,
        },
        page: page,
        translationType: "sub",
        countryOrigin: "ALL",
      },
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

    const { data } = await axios.post(apiUrl, {
      query: gql,
      variables: { id: mangaId },
    });

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

    const { data } = await axios.post(apiUrl, {
      query: gql,
      variables: { id: mangaId },
    });

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

let fetchWithCaptchaBypass = async (gql, variables) => {
  return new Promise(async (resolve, reject) => {
    if (!global.ScrapperWindow) {
      return reject(new Error("Global ScrapperWindow is not initialized"));
    }

    const win = global.ScrapperWindow;
    
    try {
      await win.loadURL("https://allmanga.to/");
      win.show();
      
      let passed = false;
      for (let i = 0; i < 60; i++) {
        const title = await win.webContents.executeJavaScript('document.title').catch(() => "");
        if (title && !title.includes('Just a moment') && !title.includes('Cloudflare')) {
          passed = true;
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      if (!passed) {
        win.hide();
        return reject(new Error("Timeout waiting for Cloudflare captcha"));
      }

      win.hide();

      const code = `
        fetch("https://api.allanime.day/api", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: \`${gql.replace(/\n/g, ' ')}\`,
            variables: ${JSON.stringify(variables)}
          })
        }).then(res => res.json())
      `;

      const data = await win.webContents.executeJavaScript(code);
      resolve(data);
    } catch (err) {
      win.hide();
      reject(err);
    }
  });
};

async function fetchChapterPages(chapterId) {
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

    const gql = `query(
      $mangaId: String!
      $translationType: VaildTranslationTypeMangaEnumType!
      $chapterString: String!
    ) {
      chapterPages(
        mangaId: $mangaId
        translationType: $translationType
        chapterString: $chapterString
      ) {
        edges {
          pictureUrlHead
          pictureUrls
        }
      }
    }`;

    const data = await fetchWithCaptchaBypass(gql, {
      mangaId: mangaId,
      translationType: "sub",
      chapterString: chapterString
    });

    let edges = [];
    if (data?.data?.chapterPages?.edges) {
      edges = data.data.chapterPages.edges;
    } else if (data?.data?.tobeparsed) {
      const decrypted = decryptTobeparsed(data.data.tobeparsed);
      if (decrypted && decrypted.chapterPages && decrypted.chapterPages.edges) {
        edges = decrypted.chapterPages.edges;
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
  }
}

module.exports = {
  name: "allmanga",
  version: "1.0.0",
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
};

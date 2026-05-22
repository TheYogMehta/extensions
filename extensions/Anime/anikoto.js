const cheerio = require("cheerio");
const axios = require("axios");

const baseUrl = "https://anikototv.to";

async function SearchAnime(query, {}) {
  try {
    const html = await global.scrapeURL(
      `${baseUrl}/search?keyword=${encodeURIComponent(query)}`,
    );
    const $ = cheerio.load(html);
    const results = [];

    $("div.item").each((i, el) => {
      const aTag = $(el).find(".name.d-title");
      const title = aTag.text().trim() || aTag.attr("data-jp");
      let href = aTag.attr("href");
      if (!href) return;
      const match = href.match(/\/watch\/([^\/]+)/);
      if (!match) return;
      const id = match[1];

      const image = $(el).find(".ani.poster.tip img").attr("src");

      results.push({
        id: id,
        title: title,
        image: image || null,
      });
    });

    return {
      currentPage: 1,
      hasNextPage: false,
      totalPages: 1,
      results: results,
    };
  } catch (err) {
    throw new Error(err.message);
  }
}

async function fetchRecentEpisodes(filters = {}) {
  try {
    const html = await global.scrapeURL(`${baseUrl}/home`);
    const $ = cheerio.load(html);
    const results = [];

    $(".item").each((i, el) => {
      const aTag = $(el).is("a")
        ? $(el)
        : $(el).find(".name.d-title, a").first();
      const title =
        aTag.text().trim() ||
        aTag.attr("data-jp") ||
        $(el).find(".name.d-title").text().trim();
      let href = aTag.attr("href");

      if (!href) return;
      const match = href.match(/\/watch\/([^\/]+)/);
      if (!match) return;
      const id = match[1];

      const image = $(el).find(".ani.poster.tip img").attr("src");

      results.push({
        id: id,
        title: title,
        image: image || null,
      });
    });

    return {
      currentPage: 1,
      hasNextPage: false,
      totalPages: 1,
      results: results,
    };
  } catch (err) {
    throw new Error(err.message);
  }
}

async function AnimeInfo(id) {
  let suffix = id.endsWith("dub") ? "dub" : id.endsWith("sub") ? "sub" : "both";
  id = id.replace(/-(dub|sub|both)$/, "");

  const animeInfo = {
    id: `${id}-${suffix}`,
    title: "",
  };

  try {
    const html = await global.scrapeURL(`${baseUrl}/watch/${id}`);
    const $ = cheerio.load(html);

    const dataId = $("#watch-main").attr("data-id");

    animeInfo.title =
      $('h1[itemprop="name"]').text().trim() ||
      $(".title").first().text().trim() ||
      id;
    animeInfo.image =
      $('img[itemprop="image"]').attr("src") ||
      $(".ani.poster img").attr("src") ||
      null;
    animeInfo.description =
      $(".synopsis").text().trim() || $(".description").text().trim() || "";

    const genres = [];
    $(".genre a").each((i, el) => {
      genres.push($(el).text().trim());
    });
    animeInfo.genres = genres;
    animeInfo.status = "Unknown";

    $(".info .item").each((i, el) => {
      const text = $(el).text();
      if (text.includes("Status:")) {
        const status = $(el).find(".name").text().trim();
        if (status.includes("Currently Airing")) animeInfo.status = "Ongoing";
        else if (status.includes("Finished Airing"))
          animeInfo.status = "Completed";
      }
    });

    animeInfo.dataId = dataId;
    animeInfo.subOrDub = suffix;

    return animeInfo;
  } catch (error) {
    console.error("Error fetching data from AnikotoTV:", error);
    return { results: [] };
  }
}

async function fetchEpisode(dataId, page = 1) {
  try {
    const url = `${baseUrl}/ajax/episode/list/${dataId}`;
    const { data } = await axios.get(url, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: `${baseUrl}/`,
      },
    });

    const $ = cheerio.load(data.result);
    let episodes = [];

    $(".ep-item, li a").each((i, el) => {
      const epNum = $(el).attr("data-num");
      const epId = $(el).attr("data-id");
      const dataIds = $(el).attr("data-ids");
      const title =
        $(el).attr("title") ||
        $(el).find(".d-title").text().trim() ||
        `Episode ${epNum}`;

      if (epId && dataIds) {
        episodes.push({
          id: `${epId}|${dataIds}`,
          number: parseFloat(epNum),
          title: title,
          duration: "Unknown",
          lang: "both",
        });
      }
    });

    return {
      episodes: episodes,
      totalPages: 1,
      total: episodes.length,
      currentPage: 1,
    };
  } catch (err) {
    return { episodes: [], totalPages: 0, total: 0, currentPage: page };
  }
}

async function fetchEpisodeSources(episodeIdStr) {
  try {
    const isBoth = episodeIdStr.endsWith("both");
    const isDub = episodeIdStr.endsWith("dub") ? true : false;

    let cleanStr = episodeIdStr.replace(/-(dub|sub|both)$/, "");
    const parts = cleanStr.split("|");
    const epId = parts[0];
    const dataIds = parts[1];

    const serverUrl = `${baseUrl}/ajax/server/list?servers=${dataIds}`;
    const serverRes = await axios.get(serverUrl, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: `${baseUrl}/`,
      },
    });

    const $ = cheerio.load(serverRes.data.result);

    let iSource = {};
    if (!isBoth) iSource.sources = [];
    if (isBoth) iSource = { dub: { sources: [] }, sub: { sources: [] } };

    const servers = [];
    $(".type[data-type='sub'] li, .type[data-type='dub'] li").each((i, el) => {
      servers.push({
        type: $(el).closest(".type").attr("data-type"),
        linkId: $(el).attr("data-link-id"),
        name: $(el).text().trim(),
      });
    });

    for (const server of servers) {
      if (!server.linkId) continue;

      try {
        const getUrl = `${baseUrl}/ajax/server?get=${server.linkId}`;
        const linkRes = await axios.get(getUrl, {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Referer: `${baseUrl}/`,
          },
        });

        const iframeUrl = linkRes.data.result.url;
        if (iframeUrl) {
          const html = await global.scrapeURL(iframeUrl);
          const m3u8Regex =
            /https:\/\/[a-zA-Z0-9\-\.]+\/[a-zA-Z0-9\/\-\._]+\.m3u8[^"'\s]*/;
          const match = html.match(m3u8Regex);

          if (match && match[0]) {
            const sourceObj = {
              url: match[0],
              isM3U8: true,
              quality: "auto",
              isDub: server.type === "dub",
            };

            if (isBoth) {
              if (sourceObj.isDub) iSource.dub.sources.push(sourceObj);
              else iSource.sub.sources.push(sourceObj);
            } else {
              if (isDub && sourceObj.isDub) iSource.sources.push(sourceObj);
              else if (!isDub && !sourceObj.isDub)
                iSource.sources.push(sourceObj);
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    return iSource;
  } catch (err) {
    console.error("Error fetching data from AnikotoTV:", err);
    return { sources: [] };
  }
}

module.exports = {
  name: "anikoto",
  version: "1.0.0",
  SearchAnime,
  AnimeInfo,
  fetchEpisodeSources,
  fetchRecentEpisodes,
  fetchEpisode,
};

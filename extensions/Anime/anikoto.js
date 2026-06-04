const cheerio = require("cheerio");

const baseUrl = "https://anikototv.to";

function parsePagination($, defaultPage) {
  let totalPages = 1;
  $(".pagination a").each((i, el) => {
    const href = $(el).attr("href");
    if (href) {
      const match = href.match(/page=(\d+)/);
      if (match) {
        const pageNum = parseInt(match[1]);
        if (pageNum > totalPages) {
          totalPages = pageNum;
        }
      }
    }
  });

  let hasNextPage = false;
  $(".pagination a").each((i, el) => {
    const rel = $(el).attr("rel");
    if (rel === "next") {
      hasNextPage = true;
    }
  });

  const activePageText = $(
    ".pagination li.active, .pagination li.page-item.active",
  )
    .text()
    .trim();
  const currentPage = parseInt(activePageText) || defaultPage || 1;

  return {
    currentPage,
    hasNextPage,
    totalPages,
  };
}

async function SearchAnime(query, filters = {}) {
  try {
    const page = filters?.page || 1;
    const { data: html } = await global.axios.get(
      `${baseUrl}/search?keyword=${encodeURIComponent(query)}&page=${page}`,
    );
    const $ = cheerio.load(html);
    const results = [];

    $("div.item").each((i, el) => {
      const aTag = $(el).find(".name.d-title");
      const title =
        aTag.text().trim() ||
        aTag.attr("data-jp") ||
        aTag.attr("title") ||
        $(el).find(".name.d-title").text().trim() ||
        $(el).find(".title").text().trim();
      let href = aTag.attr("href");
      if (!href) return;
      const match = href.match(/\/watch\/([^\/]+)/);
      if (!match) return;
      const id = match[1];

      const image =
        $(el).find(".ani.poster img").attr("src") ||
        $(el).find("img").attr("src");

      results.push({
        id: id,
        title: title,
        image: image || null,
      });
    });

    const pagination = parsePagination($, page);

    return {
      currentPage: pagination.currentPage,
      hasNextPage: pagination.hasNextPage,
      totalPages: pagination.totalPages,
      results: results,
    };
  } catch (err) {
    throw new Error(err.message);
  }
}

async function fetchRecentEpisodes(filters = {}) {
  try {
    const page = filters?.page || 1;
    const { data: html } = await global.axios.get(
      `${baseUrl}/latest-updated?page=${page}`,
    );
    const $ = cheerio.load(html);
    const results = [];

    $(".item").each((i, el) => {
      const aTag = $(el).find(".name.d-title").length
        ? $(el).find(".name.d-title").first()
        : $(el).find("a").last();
      const imgTag = $(el).find("img");

      const title =
        $(el).find(".name.d-title").text().trim() ||
        $(el).find(".title").text().trim() ||
        imgTag.attr("title") ||
        imgTag.attr("alt") ||
        aTag.attr("title") ||
        aTag.attr("data-jp") ||
        aTag
          .text()
          .trim()
          .replace(/TV\s*Sub\s*Dub/i, "")
          .trim();

      let href = $(el).find("a").first().attr("href") || aTag.attr("href");

      if (!href) return;
      const match = href.match(/\/watch\/([^\/]+)/);
      if (!match) return;
      const id = match[1];

      const image =
        $(el).find(".ani.poster img").attr("src") ||
        $(el).find("img").attr("src");

      results.push({
        id: id,
        title: title,
        image: image || null,
      });
    });

    const pagination = parsePagination($, page);

    return {
      currentPage: pagination.currentPage,
      hasNextPage: pagination.hasNextPage,
      totalPages: pagination.totalPages,
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
    const { data: html } = await global.axios.get(`${baseUrl}/watch/${id}`);
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
    const { data } = await global.axios.get(url, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const $ = cheerio.load(data.result);
    let episodes = [];

    $("a[data-id][data-ids], .ep-item, li a").each((i, el) => {
      const epNum = $(el).attr("data-num");
      const epId = $(el).attr("data-id");
      const dataIds = $(el).attr("data-ids");
      const title =
        $(el).attr("title") ||
        $(el).find(".d-title").text().trim() ||
        `Episode ${epNum}`;

      if (epId && dataIds) {
        const hasSub = $(el).attr("data-sub") === "1";
        const hasDub = $(el).attr("data-dub") === "1";
        let lang = "sub";
        if (hasSub && hasDub) {
          lang = "both";
        } else if (hasDub) {
          lang = "dub";
        }

        episodes.push({
          id: `${epId}|${dataIds}`,
          number: parseFloat(epNum),
          title: title,
          duration: "Unknown",
          lang: lang,
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

async function fetchSubtitlesFromServer(server, failedDomains) {
  if (!server || !server.linkId) return null;
  let domain = null;
  try {
    const getUrl = `${baseUrl}/ajax/server?get=${server.linkId}`;
    const linkRes = await global.axios.get(getUrl, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const iframeUrl = linkRes.data.result.url;
    if (iframeUrl) {
      try {
        domain = new URL(iframeUrl).origin;
        if (failedDomains && failedDomains.has(domain)) {
          return null;
        }
      } catch (e) {}

      const iframeRes = await global.axios.get(iframeUrl, {
        headers: {
          Referer: baseUrl,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        timeout: 2500,
      });
      const $iframe = cheerio.load(iframeRes.data);
      const playerDbId = $iframe("#megaplay-player").attr("data-id");
      if (playerDbId) {
        const sourcesUrl = `${domain}/stream/getSources?id=${playerDbId}`;
        const sourcesRes = await global.axios.get(sourcesUrl, {
          headers: {
            Referer: iframeUrl,
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          timeout: 2500,
        });

        if (sourcesRes.data && sourcesRes.data.tracks) {
          const subtitles = (sourcesRes.data.tracks || [])
            .filter(
              (t) =>
                t.file && (t.kind === "captions" || t.kind === "subtitles"),
            )
            .map((t) => ({
              url: t.file,
              lang: t.label || "English",
            }));
          if (subtitles.length > 0) {
            return subtitles;
          }
        }
      }
    }
  } catch (err) {
    console.error(
      `Failed to fetch fallback subtitles from ${server.name}:`,
      err.message,
    );
    if (domain && failedDomains) {
      failedDomains.add(domain);
    }
  }
  return null;
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
    const serverRes = await global.axios.get(serverUrl, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const $ = cheerio.load(serverRes.data.result);

    let iSource = {};
    if (!isBoth) iSource.sources = [];
    if (isBoth) iSource = { dub: { sources: [] }, sub: { sources: [] } };

    const servers = [];
    const subServers = [];
    $(".type[data-type='sub'] li, .type[data-type='dub'] li").each((i, el) => {
      const type = $(el).closest(".type").attr("data-type");
      const serverObj = {
        type: type,
        linkId: $(el).attr("data-link-id"),
        name: $(el).text().trim(),
      };
      if (type === "sub") {
        subServers.push(serverObj);
      }
      if (!isBoth) {
        if (isDub && type !== "dub") return;
        if (!isDub && type !== "sub") return;
      }
      servers.push(serverObj);
    });

    const failedDomains = new Set();

    for (const server of servers) {
      if (!server.linkId) continue;

      try {
        const getUrl = `${baseUrl}/ajax/server?get=${server.linkId}`;
        const linkRes = await global.axios.get(getUrl, {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        const iframeUrl = linkRes.data.result.url;
        if (iframeUrl) {
          let domain = null;
          try {
            domain = new URL(iframeUrl).origin;
          } catch (e) {}

          if (domain && failedDomains.has(domain)) {
            console.log(
              `Skipping server ${server.name} because its domain is marked as failed/down.`,
            );
            continue;
          }

          let directFetchSuccess = false;
          try {
            const iframeRes = await global.axios.get(iframeUrl, {
              headers: {
                Referer: baseUrl,
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              },
              timeout: 3000,
            });
            const $iframe = cheerio.load(iframeRes.data);
            const playerDbId = $iframe("#megaplay-player").attr("data-id");
            if (playerDbId) {
              const domainName = new URL(iframeUrl).origin;
              const sourcesUrl = `${domainName}/stream/getSources?id=${playerDbId}`;
              const sourcesRes = await global.axios.get(sourcesUrl, {
                headers: {
                  Referer: iframeUrl,
                  "X-Requested-With": "XMLHttpRequest",
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                },
                timeout: 3000,
              });

              if (sourcesRes.data && sourcesRes.data.sources) {
                const m3u8Url =
                  sourcesRes.data.sources.file ||
                  (Array.isArray(sourcesRes.data.sources)
                    ? sourcesRes.data.sources[0]?.file
                    : null);
                if (m3u8Url) {
                  const subtitles = (sourcesRes.data.tracks || [])
                    .filter(
                      (t) =>
                        t.file &&
                        (t.kind === "captions" || t.kind === "subtitles"),
                    )
                    .map((t) => ({
                      url: t.file,
                      lang: t.label || "English",
                    }));

                  const sourceObj = {
                    url: m3u8Url,
                    isM3U8: true,
                    quality: server.name || "auto",
                    isDub: server.type === "dub",
                    headers: { Referer: domainName + "/" },
                  };

                  if (isBoth) {
                    if (sourceObj.isDub) {
                      iSource.dub.sources.push(sourceObj);
                      if (subtitles && subtitles.length > 0) {
                        iSource.dub.subtitles = subtitles;
                      }
                    } else {
                      iSource.sub.sources.push(sourceObj);
                      if (subtitles && subtitles.length > 0) {
                        iSource.sub.subtitles = subtitles;
                      }
                    }
                    if (subtitles && subtitles.length > 0) {
                      if (
                        !iSource.subtitles ||
                        iSource.subtitles.length === 0
                      ) {
                        iSource.subtitles = subtitles;
                      }
                    }
                  } else {
                    if (isDub && sourceObj.isDub) {
                      iSource.sources.push(sourceObj);
                      if (subtitles && subtitles.length > 0) {
                        iSource.subtitles = subtitles;
                      }
                    } else if (!isDub && !sourceObj.isDub) {
                      iSource.sources.push(sourceObj);
                      if (subtitles && subtitles.length > 0) {
                        iSource.subtitles = subtitles;
                      }
                    }
                  }
                  directFetchSuccess = true;
                }
              }
            }
          } catch (err) {
            console.error(
              "Direct fetch failed, falling back to ScrapperWindow:",
              err.message,
            );
            const isTimeout =
              err.code === "ECONNABORTED" ||
              err.message?.toLowerCase().includes("timeout");
            const isConnectionError =
              !err.response ||
              err.code === "ENOTFOUND" ||
              err.code === "ECONNREFUSED" ||
              (err.response.status >= 500 &&
                err.response.status <= 599 &&
                err.response.status !== 503);
            if (iframeUrl && (isTimeout || isConnectionError)) {
              try {
                const domainName = new URL(iframeUrl).origin;
                failedDomains.add(domainName);
              } catch (e) {}
            }
          }

          if (!directFetchSuccess) {
            let shouldScrap = true;
            try {
              const domainName = new URL(iframeUrl).origin;
              if (failedDomains.has(domainName)) {
                shouldScrap = false;
              }
            } catch (e) {}

            if (shouldScrap && global.ScrapperWindow) {
              global.LastM3u8 = null;
              await global.ScrapperWindow.loadURL(iframeUrl).catch(() => {});

              let m3u8Url = null;
              for (let i = 0; i < 50; i++) {
                if (global.LastM3u8 && global.LastM3u8.includes(".m3u8")) {
                  m3u8Url = global.LastM3u8;
                  break;
                }
                await new Promise((r) => setTimeout(r, 200));
              }

              if (m3u8Url) {
                const sourceObj = {
                  url: m3u8Url,
                  isM3U8: true,
                  quality: server.name || "auto",
                  isDub: server.type === "dub",
                  headers: { Referer: "https://megaplay.buzz/" },
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
            } else if (!shouldScrap) {
              console.log(
                `Skipped ScrapperWindow rendering for failed domain: ${iframeUrl}`,
              );
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    // Fallback logic for subtitles if they are empty
    if (isBoth) {
      if (
        (!iSource.dub.subtitles || iSource.dub.subtitles.length === 0) &&
        iSource.sub.subtitles &&
        iSource.sub.subtitles.length > 0
      ) {
        iSource.dub.subtitles = iSource.sub.subtitles;
      }
      if (
        (!iSource.sub.subtitles || iSource.sub.subtitles.length === 0) &&
        iSource.dub.subtitles &&
        iSource.dub.subtitles.length > 0
      ) {
        iSource.sub.subtitles = iSource.dub.subtitles;
      }
      if (
        (!iSource.dub.subtitles || iSource.dub.subtitles.length === 0) &&
        (!iSource.sub.subtitles || iSource.sub.subtitles.length === 0)
      ) {
        for (const subServer of subServers) {
          const subs = await fetchSubtitlesFromServer(subServer, failedDomains);
          if (subs && subs.length > 0) {
            iSource.dub.subtitles = subs;
            iSource.sub.subtitles = subs;
            iSource.subtitles = subs;
            break;
          }
        }
      }
    } else {
      if (!iSource.subtitles || iSource.subtitles.length === 0) {
        for (const subServer of subServers) {
          const subs = await fetchSubtitlesFromServer(subServer, failedDomains);
          if (subs && subs.length > 0) {
            iSource.subtitles = subs;
            break;
          }
        }
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
  version: "2.0.0",
  SearchAnime,
  AnimeInfo,
  fetchEpisodeSources,
  fetchRecentEpisodes,
  fetchEpisode,
};

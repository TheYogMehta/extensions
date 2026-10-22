/**
 * StrawVerse Extension - Cinejoy Movie & Series Scraper
 * Based on https://cinejoy.pk/ and StrawVerse Extension Specification.
 */

const baseUrl = "https://cinejoy.pk";
const tmdbApiKey = "8476a7ab80ad76f0936744df0430e67c";
const tmdbBase = "https://api.themoviedb.org/3";
const imageBase = "https://image.tmdb.org/t/p";

// Declarative header rules for Cinejoy and CDN servers
const headerRules = [
  {
    match: ["cinejoy", "bright67", "nebula", "wing.st", "cheaptruckrepairs"],
    headers: {
      Referer: "https://cinejoy.pk/",
      Origin: "https://cinejoy.pk",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
  },
];

const subrequestHeaders = [
  {
    match: ["bright67", "nebula", "wing.st"],
    headers: {
      Referer: "https://cinejoy.pk/",
      Origin: "https://cinejoy.pk",
    },
  },
];

const bypassDomains = ["cinejoy", "bright67", "nebula", "wing.st", "cheaptruckrepairs"];

// Resilient HTTP request helper (uses global.axios if available, falls back to native fetch)
async function httpGet(url, options = {}) {
  if (global.axios) {
    return await global.axios.get(url, options);
  }
  const headers = options.headers || {};
  const timeoutMs = options.timeout || 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
    return { data, status: res.status, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

function normalizePage(arg) {
  if (typeof arg === "number" && Number.isFinite(arg)) {
    return Math.max(1, Math.min(500, Math.floor(arg)));
  }
  if (typeof arg === "string" && /^\d+$/.test(arg.trim())) {
    return Math.max(1, Math.min(500, parseInt(arg.trim(), 10)));
  }
  if (typeof arg === "object" && arg !== null) {
    if (typeof arg.page === "number" && Number.isFinite(arg.page)) {
      return Math.max(1, Math.min(500, Math.floor(arg.page)));
    }
    if (typeof arg.page === "string" && /^\d+$/.test(arg.page.trim())) {
      return Math.max(1, Math.min(500, parseInt(arg.page.trim(), 10)));
    }
  }
  return 1;
}

/**
 * Search anime, movies, and TV series across Cinejoy / TMDB catalog.
 * StrawVerse calls SearchAnime(query, filters)
 */
async function SearchAnime(query, filters = {}) {
  try {
    const page = normalizePage(filters);
    const cleanQuery = typeof query === "string" ? query.trim() : String(query || "");
    if (!cleanQuery) {
      return { currentPage: 1, hasNextPage: false, totalPages: 1, results: [] };
    }

    const url = `${tmdbBase}/search/multi?query=${encodeURIComponent(
      cleanQuery,
    )}&page=${page}&include_adult=false&api_key=${tmdbApiKey}`;

    const { data } = await httpGet(url, {
      headers: { Referer: "https://cinejoy.pk/" },
    });

    const results = (data.results || [])
      .filter((item) => item.media_type === "movie" || item.media_type === "tv")
      .map((item) => {
        const isMovie = item.media_type === "movie";
        const title = isMovie ? item.title : item.name;
        const releaseDate = isMovie ? item.release_date : item.first_air_date;
        const year = releaseDate ? releaseDate.split("-")[0] : "";
        const image = item.poster_path
          ? `${imageBase}/w500${item.poster_path}`
          : item.backdrop_path
          ? `${imageBase}/w500${item.backdrop_path}`
          : null;

        return {
          id: `${item.media_type}:${item.id}`,
          title: title || "Unknown Title",
          image: image || null,
          year,
          rating: item.vote_average ? item.vote_average.toFixed(1) : null,
        };
      });

    const totalPages = Math.min(data.total_pages || 1, 500);

    return {
      currentPage: page,
      hasNextPage: page < totalPages,
      totalPages: totalPages,
      results,
    };
  } catch (err) {
    console.error("Cinejoy search error:", err.message);
    return { currentPage: 1, hasNextPage: false, totalPages: 1, results: [] };
  }
}

/**
 * Fetch latest trending releases for the home feed.
 * StrawVerse calls fetchRecentEpisodes(filters)
 */
async function fetchRecentEpisodes(filters = {}) {
  try {
    const page = normalizePage(filters);
    const url = `${tmdbBase}/trending/all/day?page=${page}&api_key=${tmdbApiKey}`;
    const { data } = await httpGet(url, {
      headers: { Referer: "https://cinejoy.pk/" },
    });

    const results = (data.results || [])
      .filter((item) => item.media_type === "movie" || item.media_type === "tv")
      .map((item) => {
        const isMovie = item.media_type === "movie";
        const title = isMovie ? item.title : item.name;
        const image = item.poster_path
          ? `${imageBase}/w500${item.poster_path}`
          : item.backdrop_path
          ? `${imageBase}/w500${item.backdrop_path}`
          : null;

        return {
          id: `${item.media_type || "movie"}:${item.id}`,
          title: title || "Unknown Title",
          image: image || null,
        };
      });

    const totalPages = Math.min(data.total_pages || 1, 500);

    return {
      currentPage: page,
      hasNextPage: page < totalPages,
      totalPages: totalPages,
      results,
    };
  } catch (err) {
    console.error("Cinejoy fetchRecentEpisodes error:", err.message);
    return { currentPage: 1, hasNextPage: false, totalPages: 1, results: [] };
  }
}

/**
 * Fetch metadata for a selected title.
 * StrawVerse calls AnimeInfo(id)
 */
async function AnimeInfo(id) {
  try {
    let type = "movie";
    let tmdbId = id;

    if (String(id).includes(":")) {
      const parts = String(id).split(":");
      type = parts[0];
      tmdbId = parts[1];
    }

    const endpoint = type === "tv" ? "tv" : "movie";
    const appendParams =
      type === "tv"
        ? "content_ratings,images,credits,seasons,external_ids"
        : "release_dates,images,credits,videos,external_ids";

    const url = `${tmdbBase}/${endpoint}/${tmdbId}?append_to_response=${appendParams}&api_key=${tmdbApiKey}`;
    const { data } = await httpGet(url, {
      headers: { Referer: "https://cinejoy.pk/" },
    });

    const isMovie = endpoint === "movie";
    const title = isMovie ? data.title : data.name;
    const poster = data.poster_path
      ? `${imageBase}/w500${data.poster_path}`
      : data.backdrop_path
      ? `${imageBase}/original${data.backdrop_path}`
      : null;

    const episodes = [];
    if (isMovie) {
      episodes.push({
        id: `movie:${tmdbId}:1:1`,
        number: 1,
        episode: 1,
        title: title,
      });
    } else if (Array.isArray(data.seasons)) {
      for (const season of data.seasons) {
        if (season.season_number > 0) {
          for (let ep = 1; ep <= (season.episode_count || 1); ep++) {
            episodes.push({
              id: `tv:${tmdbId}:${season.season_number}:${ep}`,
              number: ep,
              season: season.season_number,
              episode: ep,
              title: `Season ${season.season_number} Episode ${ep}`,
            });
          }
        }
      }
    }

    return {
      id: `${endpoint}:${tmdbId}`,
      dataId: `${endpoint}:${tmdbId}`,
      title: title || "Unknown Title",
      image: poster,
      description: data.overview || "",
      genres: (data.genres || []).map((g) => g.name),
      status: data.status || "Completed",
      totalEpisodes: episodes.length,
      episodes,
    };
  } catch (err) {
    console.error("Cinejoy AnimeInfo error:", err.message);
    throw err;
  }
}

/**
 * Fetch episode list for pagination.
 * StrawVerse calls fetchEpisode(id, page)
 */
async function fetchEpisode(id, page = 1) {
  try {
    const info = await AnimeInfo(id);
    return {
      TotalPages: 1,
      total: info.episodes.length,
      episodes: info.episodes,
    };
  } catch (err) {
    console.error("Cinejoy fetchEpisode error:", err.message);
    return { TotalPages: 1, total: 0, episodes: [] };
  }
}


// ==================== Cinejoy High-Speed Stream Extraction Engine ====================

const { subtle } = globalThis.crypto;
let B = {}; // mock B
function M(){const k=["nMiVW6ddRSk0","xH7cNdxdGZVdK1PcBG","ncDAnuPjWOHGcJJcGmkZW7xdUSkdeuFdNCk8W5RdN2RdJ03cP8k6mSohiSoDC8kx","W7uAkMi1jcasW5qDzmkrW7a","dSkIW51fWPhcG8kXkJdcGq","nmonWPr3tfeBW4ZcNHucW4RcUmkNWOr3rgWgD8kMWQilumouWR7dVH9U","eSoSrCk1WQi","WRhdIvFdNmoVWP/cPdhcJx4","WO15srTY","ku9ul1fp","auJdMMtdNYtdVtLeF8oQkCoAW4r3W4RcV1JcP2lcGSoVCL/cNq","zhJcRCoTsSk9W6SEWPyjkINdL8kdzv87iCkKWQuQBby2","W5JcUgxdQSkuiSos","eCoZWPlcQ34Rfhe","jCoDW43dRHiCWRhdHbP0bbrgq8k1","ACkEomosW4ldGmk+kmofy2D3","WPSczKy4","AJ7dPmkhma53DbL0CmoW","W7ldJ8oItJtcS8oaW5mxW63dUZqyW4Gdpa","W53cOmouwh4","W4lcRmkLeCkjFq","jmoiW4tdPXmwWQa","W5ZcRmk4bSksEYz5h8kcuG","pNJcVSosAHTxCYLRomo2W4S","WOFdM2JdMfhdNCkWf08","W4/cVSopwMldIGVcMmk0dae","WQtdPutdGmoM","BdrXWRtcO8oSi8k6W7b6x8om","WORcMXNdHWe/zW","W4FdPSoLdZpcQhS","mSooz8kcWO7cNa","W5pdIr4VW5lcTSk2","WPKaW6SqW6VdPmkGW7TfW6ZdK8oHW7i","W4JdTSo2mW","W4z5Fq","WR/dLu3dNSouWPe","WRDkBq","xmo/WO4AWOxcKa","W4zPWQjuWQ8","W4RcQCoCv3FdPX0","W5z1WRm","fGCOCSoasIO","lmolWO9ZEKyoW5hcHaG","xdPEpCo1WOJcMHJdVdr2WQm","eSoFA8kCW55yW6OprqyUcqudlCouiCk3WQL1DW","aY3cHuX6nmo4WPGB","lCorWOH3sfWmW4a","n8oAWO8","WRKVWO4piwi","W4BcUmojs0JdVb/cISkNgG","pdGowSoPw2KfW4NdKSkcW7tcPG","WQtdNfldO1K","WQhdI8oD","W5HWwCkPWQK","aComCmklW5m","WRaKWOmhmw8","g30aFSkOW5/cHYVdMI48WRKHWRiDWPa6nmkphuDly8oIn8o1cmoPa2RdOSkRFSopECobdbW7nmkFWRRdTG","W4ddSSoSnCozbq","WQ/dGmoAWONcM2JdPSkEWQn3cW","W6xdVCkoWQhdTq","ce9xj1DE","WQpcQ8kjW7ibr1i","k8oTyg80lmk9W4VcNWG","kSokWPzHtea","WPepq3msWQxcTa","WOmKW7xdUHegW59BW6RdQW","mSotWPBcPh4","WR3cU8kyW6asuLyV","CweeCbSzW4HZfIddGCklW6y","WORdRdr3W4u","W5DIWQJcPHKGW6r6W4tdHZ0","xhhdHru6ECkaWQOOubZdTgS","lI0Uy8oV","W53dVZ4wodZcGwzQqGW","WP/cQ8kYW4GJ","WQ3cVmkdW7eutXKLW57cUYT+x8oDimoGxCooWQHHW6RcPqtdOCkSm8k3W65BW53cUw7cImkomae6qmkqbZjfW7rfW4jhySk8wJ/dPHpcRfVdHSkfWOajWRNcPmkDkrpdJKNcPJldH8kIduu","kmo4EguB","WRxdMSoiWONcJ3u","WO0xWQ3cP8kmW5q","dSoiASkpW49t","WQtdM8opWPVcN3q","W6FdNCk/WPZdO8kGhCkYW5STqSou","W7WClMuWjvuHW6KRzmkN","W5JcUhVdTSkhpa","jCotWPDSsG","aCo0WONcUNG2","WOhcOW4QimoOBmkgW7hdImohWPtdGmo4tG","W53cUCoFt3FdRq","jI7dPCkQxmo9W6OyWR0EFZm","kdbBjLTc","oeFcPSolWRu","WQRcPfe","mCoSySkmW7m","hWC6BConqIW","WPJcHhBcVmoCtGa","kmoAWPvKxvO","WPSlt3O","gc41Cmoh","WR7cVmkvW7ufq0m/W4tcT39Gx8kojCoHuSolWQWOW6/cT0BdOmkOzmoXW7fBW5/cQg8","jmoiW4BdUqyjWRC","WO1HWODFn3e","ggmgACkO","W7hdMmoSvG7cOSorW4SnW6BcQaG","W4hdIMRdO1VdImkG","WRdcNmoDvvD4","W5tcR2tdUmkmb8ocuSk/WOBdSq","lCoFAmkrWO/cHW","dYddO0FdUuxdP8kOWQhcGq","W7FdMCkQWPpdLa","W4xcMINcHG7cG8oRje9WW4ZcJL8","a8o7z2C9","WQRdO2hdNSoL","WR8MWP/dVSk+W6rY","WPVcQConAx/dUGC","iu9BjeLiW6u","WQddM8ohWP7cJM/dVCkz","emoFW4RdVXOAWRFdJbLknaryrCkK","W7ldJ8oItJtcS8oaW5mxW63dUYSnW48EpcnVWRNcRab9tmkTDf/dRJdcQdhdJXhdLG","W4JcVmkLfCkjFdPY","WQFdICoFWP7cUa","W5XfWRPsWQZcRG","W4L4WR1QWOS","WOtcTSoIza","WONdMCo3W7XAWPi","WOhcMKddLGK5FhW","WQNcKSohvmoReG","W4HuWQ8","EMLl","WOnRWO1b","WRrDDIfHFMyUW4i/iCkaW5CQiMhcVb7dOqhcMahdHSkyWPrtiMFdHIFcPmoi","WO7dJSoTW75xWO3cIW","vmo/WOmsWPxcNq","cqCRBCoatIO","WOpcVGOxm8oYEW","WOtcSXWEjmo0","WRqQfSoStmks","nZbb","WRZcR8kn","WRJcRuNdVSo4","WReKWOapn34","Ew1ngmk4","CSkzWPFcUJiXWOZdTJfT","hZZdU03dL0C","eSoFA8kCW55yW6OprqyUcqudlCouaCkcWO4fnGfTwNpcRSk6WQP4WQzMWP3dRmof","W47dOSoKnmoihW","iSokWPvGxvSaW4S"];return M=function(){return k},M()}const i=K;(function(k,o){const W={_0x552b3e:503,_0xd9f131:"ZL&G",_0x4ad3e7:483,_0x459db8:"rkD8",_0x57ebca:489,_0x1a4b17:455,_0x4c9238:576,_0x35a075:538,_0x5970db:"DV^a",_0x6240a1:"Fi1R",_0x296b9b:520},d=K,c=K,x=k();for(;;)try{if(-parseInt(d(570,"TFqV"))/1+parseInt(c(W._0x552b3e,W._0xd9f131))/2+-parseInt(c(W._0x4ad3e7,W._0x459db8))/3*(-parseInt(d(W._0x57ebca,"h1NJ"))/4)+parseInt(d(W._0x1a4b17,"spL4"))/5*(-parseInt(c(W._0x4c9238,"vmf3"))/6)+parseInt(c(W._0x35a075,W._0x5970db))/7+-parseInt(d(451,W._0x6240a1))/8+-parseInt(d(W._0x296b9b,"U$(9"))/9===o)break;x.push(x.shift())}catch{x.push(x.shift())}})(M,-215830+-535*-1727);const wW=i(511,"DS4v"),ZW=-1*1511+3636+-2081,g=-2017*-1+1*8099+-10084,_W=1,TW=-6953+319*22,oW=g+_W+TW,kW=-5092+11*464,fW=5789+8210*-1+2437*1,RW=new TextEncoder,BW=new TextDecoder;class l extends Error{constructor(o,W){const d={_0x387176:537,_0xa94c49:584,_0x5388e8:"X56]",_0x15deb4:"rkD8"},c=i;super(o),this[c(d._0x387176,"spL4")]=W,this[c(d._0xa94c49,d._0x5388e8)]=c(458,d._0x15deb4)}}const I=new Map;function xW(){var c;const k={_0x13c14c:465,_0x1f2b2c:"SCyZ",_0x2fa17c:575,_0x930ebe:"W[$X"},o=i,W=i,d=(c=globalThis[o(k._0x13c14c,k._0x1f2b2c)])==null?void 0:c[o(k._0x2fa17c,"spL4")];if(!d)throw new l(W(563,k._0x930ebe));return d}function V(k){const o={_0x310048:486,_0x18cf8e:"&pUO",_0xcf7fe6:589,_0x34c701:"KOP$",_0x1c7666:495,_0x1fca5e:"S8Gi",_0x5d24f0:550,_0x2d30d1:"4RQx"},W=i;return k[W(o._0x310048,o._0x18cf8e)][W(o._0xcf7fe6,"x2AX")](k[W(449,o._0x34c701)],k[W(o._0x1c7666,o._0x1fca5e)]+k[W(o._0x5d24f0,o._0x2d30d1)])}function OW(k){return k[i(474,"aKt6")](/\/+$/,"")}async function MW(k,o){const W={_0x1bc54b:561,_0x628d1d:484,_0x540832:"KOP$",_0x4af35b:466,_0x2da17a:532,_0xb3442a:"nIs2",_0x5b72c8:448,_0x1ef5d4:"ZL&G",_0xe989de:"U$(9",_0x3f1e63:"KfgW",_0x59e7c6:534,_0x3edc3b:554,_0x293f35:571,_0x135389:548,_0x576efb:"pO)(",_0x31ea8c:"*K@e",_0x334701:"D]Lr",_0x4c6aa7:"*8sR"},d=i,c=i,x={iXyrv:function(r,_){return r instanceof _},PUfnr:function(r,_){return r instanceof _},SAfdH:function(r,_){return r!==_}};let e;try{e=await fetch(k+d(W._0x1bc54b,"HCxn"),{cache:o?c(W._0x628d1d,W._0x540832):d(W._0x4af35b,"AkfH")})}catch(r){throw r}if(!e.ok)throw new l(c(W._0x2da17a,W._0xb3442a)+e[c(W._0x5b72c8,W._0x1ef5d4)],e[d(566,"zloi")]);let a;try{a=await WebAssembly[c(546,"pO)(")](await e[d(447,"KfgW")](),{})}catch(r){throw new l(d(493,"D]Lr")+(x[d(526,W._0xe989de)](r,Error)?r[c(500,W._0x3f1e63)]:String(r))+")")}const C=a[d(W._0x59e7c6,"D]Lr")][c(475,"%#EZ")];if(!x[d(W._0x3edc3b,"&V(h")](C[d(W._0x293f35,W._0x3f1e63)],WebAssembly[d(W._0x135389,"c75n")])||typeof C[c(480,"b^[0")]!==d(457,W._0x576efb)||typeof C[c(519,W._0x31ea8c)]!==d(487,W._0x334701)||x[d(580,"nIs2")](typeof C[d(569,"WE$)")],c(460,W._0x4c6aa7)))throw new l(d(485,"nIs2"));return C}function K(k,o){k=k-(-2*4402+-3617+12867);const W=M();let d=W[k];if(K.DnXaOl===void 0){var c=function(r){const _="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";let t="",m="";for(let n=0,f,S,P=0;S=r.charAt(P++);~S&&(f=n%4?f*64+S:S,n++%4)?t+=String.fromCharCode(255&f>>(-2*n&6)):0)S=_.indexOf(S);for(let n=0,f=t.length;n<f;n++)m+="%"+("00"+t.charCodeAt(n).toString(16)).slice(-2);return decodeURIComponent(m)};const C=function(r,_){let t=[],m=0,n,f="";r=c(r);let S;for(S=0;S<256;S++)t[S]=S;for(S=0;S<256;S++)m=(m+t[S]+_.charCodeAt(S%_.length))%256,n=t[S],t[S]=t[m],t[m]=n;S=0,m=0;for(let P=0;P<r.length;P++)S=(S+1)%256,m=(m+t[S])%256,n=t[S],t[S]=t[m],t[m]=n,f+=String.fromCharCode(r.charCodeAt(P)^t[(t[S]+t[m])%256]);return f};K.vNmnXz=C,K.qMniUl={},K.DnXaOl=!0}const x=W[-5*-1145+-2380+-3345],e=k+x,a=K.qMniUl[e];return a?d=a:(K.fqMvaw===void 0&&(K.fqMvaw=!0),d=K.vNmnXz(d,o),K.qMniUl[e]=d),d}function U(k,o=!1){const W={_0x1b1868:540,_0x246229:542},d={_0x1439e4:468,_0x5695ea:"U$(9",_0x572c3a:446},c=i,x=i,e=I[c(W._0x1b1868,"pO)(")](k);if(e&&!o)return e;const a=MW(k,o);return I[x(478,"T&&*")](k,a),a[x(W._0x246229,"nIs2")](()=>{const C=x,r=c;I[C(d._0x1439e4,d._0x5695ea)](k)===a&&I[r(d._0x572c3a,"1CJG")](k)}),a}function gW(k,o){return I[i(528,"f@50")](k)!==o?U(k):U(k,!0)}async function UW(k,o,W){const d={_0x1c483e:"C3pF",_0x4ac2d7:512,_0x40612f:"Fi1R",_0xde0054:"&V(h",_0x33dafe:508,_0x567a50:"4RQx",_0x5c013d:480,_0x4014e7:"koOJ",_0x381e85:"D]Lr",_0x135b27:560,_0x48ed6:"aKt6",_0x3361a4:509,_0x47d9dd:"*8sR",_0x16b3a6:"aKt6",_0x37a86d:527,_0x307765:"eh93",_0x51cea7:568,_0x5006e6:"pO)(",_0x344404:"TFqV",_0x24c8ea:497,_0x36730c:"c75n",_0x1c0baf:518,_0x26e313:"ZL&G",_0x535415:463,_0x4ac4db:"U$(9",_0x5825e4:"TFqV",_0x35774a:"KfgW",_0x164b19:"%#EZ",_0xacc811:"spL4",_0x6d47da:557,_0x35a0bb:"zei6",_0x561b80:557,_0x466dce:453,_0x2869e4:490,_0x3c30ee:549,_0x501b79:456,_0x4eaab1:"S8Gi",_0x2d3290:552,_0x8770c5:545},c=i,x=i,e={LGLPX:function(f,S){return f??S},wUgyF:function(f,S){return f+S},UOubN:function(f,S){return f||S},fIfLR:function(f,S){return f<=S},IVPNv:function(f,S){return f+S},ySBgE:function(f,S){return f instanceof S}},a=await k,C=RW[c(477,d._0x1c483e)](JSON[x(d._0x4ac2d7,d._0x40612f)]({path:o,payload:e[x(494,"ZL&G")](W,null)})),r=new Uint8Array(ZW);globalThis[x(573,d._0xde0054)][c(574,"%#EZ")](r);const _=e[c(514,"S8Gi")](C[x(d._0x33dafe,"*8sR")],-1430+971*2),t=a[c(564,d._0x567a50)](C[x(497,"c75n")]),m=a[c(d._0x5c013d,"b^[0")](r[x(588,d._0x4014e7)]),n=a[c(572,d._0x381e85)](_);if(e[c(d._0x135b27,d._0x48ed6)](!t,!m)||!n)throw t&&a[x(d._0x3361a4,"rkD8")](t,C[x(508,d._0x47d9dd)]),m&&a[x(581,d._0x16b3a6)](m,r[c(577,"T&&*")]),n&&a[c(d._0x37a86d,"spL4")](n,_),new l(c(459,"TW1c"));try{let f=new Uint8Array(a[c(481,d._0x307765)][x(d._0x51cea7,d._0x5006e6)]);f[x(524,d._0x344404)](C,t),f[c(535,"D]Lr")](r,m);const S=a[c(590,"TW1c")](t,C[x(d._0x24c8ea,d._0x36730c)],m,r[c(d._0x1c0baf,d._0x26e313)],n,_);if(e[x(d._0x535415,d._0x4ac4db)](S,oW)||S>_)throw new l(c(471,d._0x5825e4)+S+")");f=new Uint8Array(a[c(571,d._0x35774a)][c(476,d._0x164b19)]);const P=f[c(507,d._0xacc811)](n,e[c(496,"TFqV")](n,S));return{responseKey:P[x(d._0x6d47da,d._0x35a0bb)](-14249+14249*1,g),keyId:P[g],ephemeralPublic:P[x(d._0x6d47da,d._0x35a0bb)](g+_W,oW),body:P[x(d._0x561b80,"zei6")](oW)}}catch(f){throw e[c(d._0x466dce,"S8Gi")](f,l)?f:new l(x(d._0x2869e4,"T&&*")+(f instanceof Error?f[x(d._0x3c30ee,"W[$X")]:String(f))+")")}finally{a[x(d._0x501b79,d._0x36730c)](t,C[c(523,d._0x4eaab1)]),a[c(d._0x2d3290,"X56]")](m,r[c(d._0x8770c5,"&pUO")]),a[c(517,"TM@v")](n,_)}}function DW(k,o){const W={_0x5a7575:"eh93",_0xe1efd:583,_0x185862:"D]Lr",_0x2490f3:543,_0x151dae:"eh93",_0x8427d6:522,_0x4e54ae:579,_0x12ab3c:"b^[0",_0x19839f:"DV^a"},d=i,c=i,x=RW[d(536,W._0x5a7575)](wW),e=new Uint8Array(x[d(W._0xe1efd,W._0x185862)]+(-1*-5534+2770*-3+7*397)+o[c(W._0x2490f3,W._0x151dae)]);return e[d(W._0x8427d6,"!n@7")](x),e[d(W._0x4e54ae,W._0x12ab3c)]([3676+-34*273+1*5606,2,k],x[d(567,"nIs2")]),e[c(469,W._0x19839f)](o,x[d(488,"(1tz")]+(-5353+2067*-4+13624)),e}async function jW(k,o){const W={_0x4958c3:586,_0xd54ea3:"W[$X",_0x3abf38:473,_0x53c97e:"IoqB",_0x4d8e1c:539,_0x3977bd:533,_0x5ab8af:"0f^n",_0xc30793:479,_0x241f0a:"!n@7",_0x3ae10b:510,_0x70cccc:"*8sR",_0x3df91f:582,_0x1a8bc8:472,_0x1f6b57:454,_0x24749d:"&V(h",_0x5278da:578,_0x34736b:"rkD8",_0x31432f:555,_0x54f06e:"DV^a",_0x2a179b:565,_0x55f0d6:"pO)(",_0x53c371:551,_0x12d9a1:"D]Lr",_0x524c38:521,_0x2ea6c8:"&pUO",_0x22c6c5:504,_0x23633c:"X56]",_0x188fb7:"x2AX",_0x16d2db:"aKt6"},d=i,c=i,x={PsHRf:d(W._0x4958c3,W._0xd54ea3),mlPgM:function(e,a){return e(a)},nhDYF:c(498,"h1NJ")};if(k[d(W._0x3abf38,W._0x53c97e)]<kW+fW)throw new l(x[d(W._0x4d8e1c,"Fi1R")]);try{const e=await xW()[d(W._0x3977bd,W._0x5ab8af)](d(W._0xc30793,"W[$X"),x[c(541,W._0x241f0a)](V,o[d(W._0x3ae10b,W._0x70cccc)]),d(W._0x3df91f,"b^[0"),!1,[d(W._0x1a8bc8,"SCyZ")]),a=await xW()[d(587,"rkD8")]({name:c(W._0x1f6b57,"zloi"),iv:V(k[c(501,W._0x24749d)](0,kW)),additionalData:V(DW(o[c(W._0x5278da,"MfNW")],o[c(502,W._0x34736b)])),tagLength:fW*8},e,V(k[c(W._0x31432f,W._0xd54ea3)](kW))),C=JSON[d(482,W._0x54f06e)](BW[d(525,"IoqB")](a));if(!C||typeof C[d(W._0x2a179b,W._0x55f0d6)]!==d(W._0x53c371,W._0x12d9a1)||!(c(W._0x524c38,W._0x2ea6c8)in C))throw new Error(x[c(W._0x22c6c5,W._0x23633c)]);return C}catch(e){throw new l(c(544,W._0x188fb7)+(e instanceof Error?e[d(529,W._0x16d2db)]:String(e))+")")}}function zW(k){const o=i;U(OW(k))[o(450,"WE$)")](()=>{})}async function PW(k,o,W,d){const c={_0x122a99:464,_0x178d5f:"1CJG",_0x2d03e3:499,_0x2d6c9b:"koOJ",_0x2ffc1a:506,_0x1eced3:"TW1c",_0x311e91:467,_0x2b736c:547,_0x5b2be1:"WE$)",_0x379b61:"spL4"},x=i,e=i,a={agvcB:function(_,t){return _(t)},qEPQI:function(_,t,m){return _(t,m)}},C=await UW(o,W,d),r=await fetch(k+"/g",{method:x(c._0x122a99,c._0x178d5f),headers:{"Content-Type":x(c._0x2d03e3,"vmf3")},body:a[e(461,"pO)(")](V,C[x(470,c._0x2d6c9b)])});if(!r.ok)throw new l(x(c._0x2ffc1a,c._0x1eced3)+r[x(462,"U$(9")],r[e(c._0x311e91,"y8fR")]);return a[e(c._0x2b736c,c._0x5b2be1)](jW,new Uint8Array(await r[e(513,c._0x379b61)]()),C)}async function EW(k,o,W){const d={_0x59c2b6:558,_0x439197:"f@50",_0x5498a5:562,_0x2d1bd8:"W[$X",_0xc110dd:"aKt6",_0x9d5caa:530,_0x33397e:"D]Lr"},c=i,x=i,e={QeHIC:function(_,t){return _(t)},JosmE:function(_,t,m,n,f){return _(t,m,n,f)},cLnqf:function(_,t){return _!==t}};xW();const a=OW(k),C=Object[c(d._0x59c2b6,d._0x439197)](W[c(516,"AkfH")]()),r=e[x(d._0x5498a5,d._0x2d1bd8)](U,a);try{return await e[x(452,"4RQx")](PW,a,r,o,C)}catch(_){if(!(_ instanceof l)||e[x(585,d._0xc110dd)](_[c(d._0x9d5caa,d._0x33397e)],404))throw _;return PW(a,gW(a,r),o,C)}}const J=G,s=G;(function(k,o){const W={_0x157bdc:"vbJE",_0x6d1698:"1Cm]",_0x5286b9:347,_0x22f816:"[SMB",_0x12ab58:264,_0x1cb57c:"notC",_0x3149fa:294,_0x336756:"gL3m",_0x1ac3c5:360,_0x44f286:"mGG@",_0x2c086e:"KS2l",_0x557322:"^Z10",_0x2241e1:319},d=G,c=G,x=k();for(;;)try{if(parseInt(d(358,"#&!]"))/1*(parseInt(c(349,W._0x157bdc))/2)+parseInt(d(362,W._0x6d1698))/3*(parseInt(c(W._0x5286b9,W._0x22f816))/4)+-parseInt(d(W._0x12ab58,W._0x1cb57c))/5+parseInt(c(W._0x3149fa,W._0x336756))/6*(-parseInt(d(302,"t50N"))/7)+parseInt(c(W._0x1ac3c5,W._0x44f286))/8*(parseInt(c(292,W._0x2c086e))/9)+-parseInt(d(304,"[SMB"))/10+parseInt(d(323,W._0x557322))/11*(parseInt(d(W._0x2241e1,"T8$y"))/12)===o)break;x.push(x.shift())}catch{x.push(x.shift())}})(j,1937858+-1*1216451);const bW={offline:J(345,"KS2l"),"domain-blocked":s(274,"OQDq"),"domain-unreachable":J(270,"zKcP"),"insecure-context":J(310,"9d20"),protection:J(318,")K[j"),blocked:J(285,"[SMB"),"server-error":J(365,"t50N"),"no-sources":s(263,"lq7*"),unknown:s(261,"ZCgg")},XW={"domain-blocked":s(279,"G%76"),"domain-unreachable":J(313,"D7L4"),offline:s(299,"wh)2"),"insecure-context":s(314,"nf4%"),"no-sources":J(359,"R7kX")};function AW(k){const o={_0x255004:"ZCgg"},W=s;return bW[k]??bW[W(372,o._0x255004)]}function YW(k){return XW[k]}const $W=[J(293,"1Cm]"),s(363,"Y(e7"),s(367,"notC"),s(352,")K[j"),J(309,"]fcZ"),s(346,"gL3m"),s(329,"D7L4"),s(343,"D7L4"),s(334,"@u!G")];function G(k,o){k=k-(-425*-5+-1004+-860);const W=j();let d=W[k];if(G.YHESLZ===void 0){var c=function(r){const _="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";let t="",m="";for(let n=0,f,S,P=0;S=r.charAt(P++);~S&&(f=n%4?f*64+S:S,n++%4)?t+=String.fromCharCode(255&f>>(-2*n&6)):0)S=_.indexOf(S);for(let n=0,f=t.length;n<f;n++)m+="%"+("00"+t.charCodeAt(n).toString(16)).slice(-2);return decodeURIComponent(m)};const C=function(r,_){let t=[],m=0,n,f="";r=c(r);let S;for(S=0;S<256;S++)t[S]=S;for(S=0;S<256;S++)m=(m+t[S]+_.charCodeAt(S%_.length))%256,n=t[S],t[S]=t[m],t[m]=n;S=0,m=0;for(let P=0;P<r.length;P++)S=(S+1)%256,m=(m+t[S])%256,n=t[S],t[S]=t[m],t[m]=n,f+=String.fromCharCode(r.charCodeAt(P)^t[(t[S]+t[m])%256]);return f};G.ThHYdi=C,G.JSVOzG={},G.YHESLZ=!0}const x=W[-5541*1+3560*-2+12661],e=k+x,a=G.JSVOzG[e];return a?d=a:(G.MGftpd===void 0&&(G.MGftpd=!0),d=G.ThHYdi(d,o),G.JSVOzG[e]=d),d}function Wc(k){const o={_0x2ec64e:281,_0x23642b:328,_0x492f39:"D7L4"},W=s,d=J;for(const c of $W)if(k[W(o._0x2ec64e,"DLkS")](c))return c;return d(o._0x23642b,o._0x492f39)}function D(k){const o={_0x34e016:"[302",_0x4ea3e5:"wh)2",_0x931f7d:291,_0x496935:"wh)2",_0x3d7fc1:275,_0x49cff6:"gL3m",_0xfb14a1:277,_0x4743c7:336,_0x3eaf4c:"w%@z",_0xca7663:"nf4%",_0x4b4d4a:378,_0x313e9e:"LTze",_0x7464e2:"J1rP",_0x36ea74:269,_0x5db7eb:"vbJE",_0x41cbe3:"DLkS",_0x233608:348,_0x2983ac:"lq7*",_0xe43c1d:342,_0x4d268f:332,_0x297118:311,_0x40702c:"lq7*",_0x4b7ab7:377,_0x360c18:"[302",_0x1805cc:288,_0x3dfcc4:"4SZ5",_0x2cd790:354,_0x5e2ddd:335,_0x45f4f4:"1Cm]",_0x2b06a4:282,_0x5058d9:"#&!]",_0xd0ee91:"^Z10",_0x2c47fc:305,_0x4811d5:"D7L4",_0x55ef97:374,_0x5f57ec:321,_0x1f82ee:"$gNw",_0x32d5cd:"vbJE",_0x3ccbec:297,_0x4ef883:375,_0x1beb7a:350,_0x36451e:366,_0x366bba:"9d20",_0x8c19b2:320,_0x192660:"2*dv",_0x2d1657:370,_0x7aad34:"JZ$4"},W=J,d=s,c={CbXrF:W(278,o._0x34e016),gVKbj:d(300,o._0x4ea3e5),lnIoQ:function(a,C){return a===C},tRHVC:W(o._0x931f7d,o._0x496935),JPnoG:W(o._0x3d7fc1,"DLkS"),sOmsY:d(301,o._0x49cff6),jpNrC:d(o._0xfb14a1,"2*dv"),mQoUe:d(o._0x4743c7,o._0x3eaf4c)},x=cc(k)[W(351,o._0xca7663)]();if(x[d(o._0x4b4d4a,o._0x313e9e)](W(356,o._0x7464e2))||x[W(o._0x36ea74,"G%76")](W(298,o._0x5db7eb)))return d(368,o._0x41cbe3);if(k instanceof TypeError||x[d(o._0x233608,o._0x2983ac)](d(o._0xe43c1d,"2*dv"))||x[d(o._0x4d268f,"2*dv")](d(o._0x297118,o._0x40702c))||x[d(315,"1Cm]")](d(o._0x4b7ab7,o._0x360c18))||x[W(o._0x1805cc,o._0x49cff6)](W(355,o._0x3dfcc4))||x[d(331,"D9WR")](d(276,"XMiq")))return d(o._0x2cd790,"T8$y");if(x[d(o._0x5e2ddd,"2eUV")](c[W(327,")K[j")])||x[W(364,"Y(e7")](d(286,o._0x45f4f4)))return c[W(o._0x2b06a4,o._0x5058d9)];const e=dc(x);return e?c[W(337,o._0xd0ee91)](e,8840+-4740*-1+-13177)||e===9596+-1*4467+-4700?c[d(333,")K[j")]:e>=500?W(o._0x2c47fc,"VEKv"):e===13263+1837*-7?c[d(325,o._0x4811d5)]:W(o._0x55ef97,"kr)G"):x[d(o._0x5f57ec,o._0x1f82ee)](d(296,o._0x32d5cd))||x[d(322,"T8$y")](c[W(283,"gL3m")])?d(o._0x3ccbec,"notC"):x[W(o._0x4ef883,"w%@z")](c[d(o._0x1beb7a,"[SMB")])||x[W(o._0x36451e,o._0x366bba)](W(357,"]fcZ"))?c[d(o._0x8c19b2,o._0x192660)]:d(o._0x2d1657,o._0x7aad34)}function cc(k){const o={_0x3c48b8:307,_0x369397:"kPTK",_0x13df7b:"LTze"},W=s,d=s;return k?typeof k===W(o._0x3c48b8,o._0x369397)?k:k instanceof Error?k[d(316,o._0x13df7b)]:String(k):""}function dc(k){const o={_0x1c8388:289},W=s,d=k[W(o._0x1c8388,"$7m[")](/\bhttp (\d{3})\b/);return d?Number(d[8054*-1+-8271*-1+-216]):null}async function oc(k,o){const W={_0x4ce3a2:"^Z10",_0x552a49:317,_0xacfb90:"d0yy",_0x4652f8:306,_0x41da65:"d0yy",_0x2f20d7:"9d20",_0x161767:"#hc7",_0xa4b3a4:287,_0x2e7578:"t50N",_0x100865:338,_0x17c54a:"DLkS",_0x54bf09:"R7kX",_0x339ea5:"]fcZ",_0x5f4a09:"4SZ5"},d=J,c=s,x={YLlzq:function(C,r){return C===r},XiEdd:d(324,W._0x4ce3a2),uZEsZ:c(W._0x552a49,W._0xacfb90),kojOF:function(C,r){return C+r},YCcXY:c(340,"w%@z"),diNje:function(C,r){return C(r)}};if(typeof navigator!==d(W._0x4652f8,"KDTc")&&x[c(312,W._0x41da65)](navigator[c(268,"#hc7")],!1))return x[d(265,W._0x2f20d7)];if(k!==x[d(280,W._0x161767)])return k;const[e,a]=await Promise[d(272,"gL3m")]([eW(x[d(267,"D9WR")](o[d(369,"zKcP")](/\/+$/,""),"/")),Promise[d(371,"7VA@")]([eW(x[c(W._0xa4b3a4,W._0x2e7578)]),x[c(W._0x100865,"nf4%")](eW,d(330,W._0x17c54a))])[c(284,W._0x54bf09)](C=>C[c(382,"JZ$4")](Boolean))]);return e?c(379,W._0x339ea5):a?c(373,"kr)G"):c(353,W._0x5f4a09)}async function eW(k,o=4e3){const W={_0x1d7faf:326,_0x45fa9e:"t50N",_0x563d87:290,_0x8052cc:"#7i2",_0x1760c1:344,_0x1d1df0:"Onq8"},d=J,c=J,x={KgMdY:d(W._0x1d7faf,W._0x45fa9e)};try{const e=new AbortController,a=setTimeout(()=>e[d(376,"t50N")](),o);try{return await fetch(k,{mode:x[d(W._0x563d87,W._0x8052cc)],cache:c(341,"#7i2"),signal:e[d(W._0x1760c1,W._0x1d1df0)]}),!0}finally{clearTimeout(a)}}catch{return!1}}function j(){const k=["WRJcKKxdT27dISkiW6XI","kGekWQSWWP0","yevjW7rPWP4ChSk1WQJcJa","WR3cUbyYW5D3zmogWPmI","wqxcHSodnmk2d8ooB1tdPSk+sSo7ymk6e8kGWP0","rH7dL1/cUaBcQSoMW5BdSxaR","p0NcUc/dHW","WO9rpujEWRpcM8kSWR/cLsf5phlcJH8UzuZcRCkcWQlcJX/dTCkuqCkOWPGJkG/cSrvcW5JcPmoOW5tcStNdHG","WRSOBmoUpvpdNCkbgCkGWPZcOgP3bctdKCosWPaYWQ3cHfavqZZcT8ksW6/cUSoLW4xcJCobFmkC","iSoMr3NdNtOUWR8","FSkirCkezeRdLa","aMRcUttdN0nWWOPrlSkxW75vW59Lev7dMG","i0ZdRZbRoJhdKGL5WRhcQ3OKztlcGmo6eCogW64+W6W","dYlcTIBcJvD6WRr3va","lmotg07dMG","W7yDlmkOBKddPta","v3xdO3lcQLfLWR0","WOT4uZ/cKY51WOhdTmkGyq","W50UbgxdJsrd","WOzPnK5Y","FZVcMCofhbnf","mfZdMdzi","WRLxm09AW6tcJa","WR9CkLDqW6hdJ8kMWRJcLw5O","WQDSzX1NurXftSk0rJejqmomWQxcLmomBJG0aa/dH8oiW6tcRSkEW4pcTSopW7uTW6FcPmkt","FxJcIKZdGmowbCkb","kmoSf3FdINNdOSoN","b2ZdIbjn","D8kDh8kcqYFdIW","W4FdKmoYsmocW7WCW6m","l8ooW5/cGvHDDmoyW4PAFSoWWQNcQ8oQW6pdJeq","W54Mk2BdTq","WOSPs8o3Ea","aLhcUbXpW69VWPhcOCkY","i8ovW4BcKeijDSkcW5nFBmk/WQ3cRmoKW6BdJetdGc1odubEdCoUq8odn1ZcJb/cLSkvWP8","l8obWPzyW4f1W5Lr","j8oJhxFdMNNcP8oGWRPYW6e5WQ5jW6u","WQjwDvjAW6BcKmkGWQ/cLa","vY1gWPpcO8oC","WOKqx8oFWOvYWQldIHVdPLZdQmkry8kNl8kwW4xcMeu1W6a","WRpdOLFdJ8okWP7dOG","pmkrWQShAWJcPCkr","qrxdGetcOHdcPmoW","sIFcQ8kLW7lcJelcT8oEjW","z8otWQ8nya","WPSVsCoYAKBdJSkLhCoZWPq","f1hdRsvNn2JdJGHLW7tcQxePzZVdJmo5","mYPMnSkgWOyV","wNtdRx/cTLSTWRTpFSoAy07cUXddSCozpG","mIL0lCkaWPOHpSkCqSkKjdRcSKjIaWbvW73cOmkJ","vHldUvXzW4CrWPhcOmkCxXFcJa","WRNcOXqJW51Hza","WPpcRZyiW5zAWOxcGW","sSo9WRhdTmoQu8owW6jSE8oTWOvcW6ZdQmk2nG8ocIJcIWbZWOZdLG","WRHsvCkvDXxcGq","v8oTtf5mCXO","ESk4eYhcNwL4WQSSWQhcS8kKWRG","lXddHceyW6/dRsrzW73cJuhdJGhdO8kW","lXddLcGoW77dUJi","qJhdHSoqfHmwWQTCWOxdPSkK","EqxcLSokiSkNgmoy","cbTOimkXW6tdMWldN3xdQmkrWPK8","WQz2yaH3hKepamk7rIOzq8oyWRa","W7DtWPRcGuO+BG","WPhcH0ZdINTHW6O","k1ZdGq","bmofzCotW57cN8kT","W4dcPcZdO3aFvmkRWQfuoCksFmox","W5hcPsRdRhygfW","iSopW5hcJerxpmoE","CdBdM8oubW","dCo7FKOfEb01W5RcTCo8","ESkdvCkBCeNdLmo4","WRJcPbiOW51JFG","oSoVWONdQCooumo/W7i","C8ozvvBdQWOH","WPFcHKRdGq","jmofzCotW57cN8kTCCo+fCo/DvS","W7qkBHCgWQtdKCkHWQhcRg5CcW","zHtcG1VcUahcS8oGW4hcO3K2W505u8kLhSkyW7q9W6iFf8o2","wuC9C8oTWRldHIBdVxddGCkCWOO","salcSmocmW","m8oKW7hcPSkZdSkhW75Qi8owWOjV","F3NcG2/dSW","tq1gm8o2W7O","WPuiu8kYCM7dUSkW","W4zxWOtdIL99ECk0WPhdTmo5W5pcRmoqWQaeW5xdPa","W7KjAXacWQVdM8knWO7cNK57hq","WRddOLq","jshcOhhdOSofaSkG","zSo1WPtcPszJxmonW7HWi8kQkSknW7NcPmkJkWdcRW/cNCkFt2RdS1nNWPC/","WQf3pH57hKejsmkR","W7dcVrP5","imoGg2NdIW","eCoMCfPaFqG1W5NcVSkI","WQGusCo+zIRdICktWRtcUXD2WPrcy8k/ymkcfXWmW6nIBmk8kCk4fWmsD0FdPHiEWRhdUXy","vZLpkCoc","WQz2CafHd1yz","W4xdJJq7W6S","WQldGvxdN8o4","F8k1WQBdVW","t8opWO4CsaVcICosW4bpgmoGcCoeW4OBWOPPjXjm","o8o6s2hdJt0/WQurWQtdGCkBWQ/dMqC","sbFdL8o+kG","WRJdOfVdGmouWP/dOYq","W6PjW7/dL8kB","cSojW7zpW6W","W71DWOpcLxpcJmkh","W79msCkaW5GXW7tdMH7dIeFcJSkQ","jmoUqNNdGtaU","W6FdT2VdNmoiWPBdOa","ESkyWOtdMgnri8oxW7jW","e3NcS8oMW6tcUxFcPCoh","aHSOmSk3W7/cHapdLMK","dNpdSmoGW6lcRJlcP8ofbthcM8kHoW","W41uWO/cMxBcH8kgW7mtW5pcVSkAW57cHCk6lr0JASkBW7ZdOG3cIq","W69dWOpcGN3cISkxW7KiWP0","WR/dOuZcJmohWPtdSZNdTa","jgtcH8kxrfKpWObQWO7dHSk3kq","WO88FZhdRcVcJZS/cI/cQw0","nCkAW5nifLBdNCkDW4foBSoYnq","W4LQnxxcVghcKHGdeGRcVq"];return j=function(){return k},j()}const v=L;function L(k,o){k=k-(1*-5489+-4639*-1+1146);const W=z();let d=W[k];if(L.mLmRGC===void 0){var c=function(r){const _="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";let t="",m="";for(let n=0,f,S,P=0;S=r.charAt(P++);~S&&(f=n%4?f*64+S:S,n++%4)?t+=String.fromCharCode(255&f>>(-2*n&6)):0)S=_.indexOf(S);for(let n=0,f=t.length;n<f;n++)m+="%"+("00"+t.charCodeAt(n).toString(16)).slice(-2);return decodeURIComponent(m)};const C=function(r,_){let t=[],m=0,n,f="";r=c(r);let S;for(S=0;S<256;S++)t[S]=S;for(S=0;S<256;S++)m=(m+t[S]+_.charCodeAt(S%_.length))%256,n=t[S],t[S]=t[m],t[m]=n;S=0,m=0;for(let P=0;P<r.length;P++)S=(S+1)%256,m=(m+t[S])%256,n=t[S],t[S]=t[m],t[m]=n,f+=String.fromCharCode(r.charCodeAt(P)^t[(t[S]+t[m])%256]);return f};L.EgWgGx=C,L.wmodKh={},L.mLmRGC=!0}const x=W[-4688+-1*7415+1*12103],e=k+x,a=L.wmodKh[e];return a?d=a:(L.uaaHXe===void 0&&(L.uaaHXe=!0),d=L.EgWgGx(d,o),L.wmodKh[e]=d),d}(function(k,o){const W={_0x4f0d1a:329,_0x42f36f:"UT!X",_0x4c9281:320,_0x10db7f:"&[)$",_0x5e6546:"p*BO",_0x3fc200:"!GTH",_0x4c6296:"U)%L"},d=L,c=L,x=k();for(;;)try{if(parseInt(d(W._0x4f0d1a,"$5Eh"))/1+parseInt(c(311,W._0x42f36f))/2*(-parseInt(d(W._0x4c9281,W._0x10db7f))/3)+-parseInt(c(332,W._0x5e6546))/4+-parseInt(c(330,W._0x3fc200))/5+-parseInt(d(334,"F8W&"))/6+-parseInt(d(304,"qiG2"))/7+parseInt(c(323,W._0x4c6296))/8===o)break;x.push(x.shift())}catch{x.push(x.shift())}})(z,18149*70+-818477+501679);const SW=v(299,"AP3a"),F=new Map;function z(){const k=["WOWVhW","pSoIWQHZWPpcUcxcKG8","b8omW7hdJ8ocWQC","WRVdJCkfDCo1oCo5lCkEW5LpCJ8","kmokW4yoW6ddS8oeECoDqmoFW5S7","mISK","WQ7cNfTmWRnOW5Tbc8osW7zeW5yIFG","cKlcS8ou","xaNcNq","lSoNWOhdOq","W5TyyKb3tmkxcCkvW40","W6dcJmotkq","wCkQW5u","W6ZcK8oena","WQ/cGLfp","iSoLWOhdRLBcIhDzW40hC2Plk8oV","egS4WOpcMarnWQWNkG","bCkBCqi","yxTMDSkyWORdPSo2xG","FeCFmLyeW5pdHrm","tCkQW5u","WOFcUs0","g3K2WRRdGK9oafSXWOldMrhcJa","WQZdHmkBlmoCWQ0","jmoDWQfzWQjsWQCPrHS8ncX3","sd50W5lcUW","tt5Z","mJJdPcvmWOTqfZq","ESk6W7WIW4ldQb/cJs8BWP/cNW","W5L7xIpcKCoOBf/cT8omhSoHW60","BYVcPeCZ","FSoSW4VcPNtdN8osWQiQhSkIW4D3","W7H5ArZcQ8k4BgVdGtO/WQ/dKq","W7XhCe8UWO5RW4y6WRNdPmkWWP8","mSkKW6ikW49psSkdWQzA","d8o5WPfmW6dcTSkEW7DYFCkyDG","WRVdJSkaDSo4omo5dmk7W6n+uIS","vJP0","WQfizCkwWOurWPWJa8oHW7GVWQa","WRhdKcn/","sdC4xvBcRmkBWReQWQ0jW7W2nq","WRtcHZZcMq"];return z=function(){return k},z()}let w=null;async function uW(){const k={_0x120a13:310,_0x2928a4:"s&sU"},o=v;if(w!==null)return w;try{w=typeof caches!==o(302,"$5Eh")&&!!await caches[o(k._0x120a13,k._0x2928a4)](SW)}catch{w=!1}return w}function kc(k){return k?F[v({_0x5d4917:322}._0x5d4917,"X[9T")](k)??null:null}async function iW(k){const o={_0x143f12:298,_0x4387fb:"L*oB",_0x2d7faf:326,_0x4933ef:"ZaT^",_0x3d4a72:"6#y@",_0x57a692:316,_0x566c62:321,_0x23ae4f:"zKEJ",_0x500dce:312,_0x4be7ec:"db(b",_0x39ee91:328,_0x13a825:"[tyY"},W=v,d=v,c={CWMyC:function(e){return e()}};if(!k)return k;const x=F[W(306,"WbNx")](k);if(x)return x;if(await uW())try{const e=await caches[W(o._0x143f12,o._0x4387fb)](SW),a=await e[W(o._0x2d7faf,o._0x4933ef)](k);if(a){const C=await a[d(315,o._0x3d4a72)](),r=URL[d(o._0x57a692,"s&sU")](C);return F[W(296,"ZaT^")](k,r),r}}catch{}try{const e=await fetch(k,{mode:d(314,"qiG2")});if(!e.ok)return k;const a=await e[W(300,"hX7%")](),C=URL[d(307,o._0x3d4a72)](a);if(F[d(o._0x566c62,o._0x23ae4f)](k,C),await c[W(331,"3P&7")](uW))try{await(await caches[W(o._0x500dce,"qiG2")](SW))[d(309,"3P&7")](k,new Response(a,{headers:{"Content-Type":a[d(308,o._0x4be7ec)]||W(o._0x39ee91,o._0x13a825)}}))}catch{}return C}catch{return k}}async function hW(k){const o={_0x488aca:303,_0x175051:324,_0x376c8a:"yPnS",_0x110e8b:301,_0x301a2f:"!GTH"},W=v,d=v,c=[...new Set(k[W(o._0x488aca,"W&ya")](x=>!!x&&!F[d(327,"ZaT^")](x)))];c[d(o._0x175051,"[Jot")]!==3590+1*-3809+219&&await Promise[W(335,o._0x376c8a)](c[d(o._0x110e8b,o._0x301a2f)](x=>iW(x)))}const R=N,O=N;(function(k,o){const W={_0x38ca85:186,_0x26250c:"EB%3",_0x16181f:169,_0x1b06d1:168,_0x1348c6:521,_0x3516d7:371,_0x496691:"[PrY",_0x1eca6e:238,_0x16333e:339,_0x578aa3:286,_0xf2492:"&7wt",_0x113c78:359,_0x101b82:"8tey"},d=N,c=N,x=k();for(;;)try{if(-parseInt(d(W._0x38ca85,W._0x26250c))/1+parseInt(d(W._0x16181f,W._0x26250c))/2*(parseInt(c(W._0x1b06d1,"pI!m"))/3)+parseInt(d(W._0x1348c6,"UL2%"))/4+parseInt(d(W._0x3516d7,W._0x496691))/5*(-parseInt(c(281,"vv9y"))/6)+parseInt(d(W._0x1eca6e,"F[Rq"))/7+-parseInt(c(W._0x16333e,W._0x26250c))/8+-parseInt(d(W._0x578aa3,W._0xf2492))/9*(-parseInt(c(W._0x113c78,W._0x101b82))/10)===o)break;x.push(x.shift())}catch{x.push(x.shift())}})(A,-910037+1262137*1);const E=R(188,"Wh1@");function xc(){const k={_0x317179:244,_0x5bde60:"O%Gp",_0x4ad038:"y](p",_0x354b89:378,_0x43c972:"Sm7D"},o=R,W={zFxED:function(d,c){return d instanceof c}};try{return Intl[o(340,")qVX")]()[o(k._0x317179,k._0x5bde60)]()[o(276,"$66q")]||null}catch(d){if(W[o(393,k._0x4ad038)](d,Error)&&d[o(k._0x354b89,"KjjR")][o(182,k._0x43c972)](o(280,"JY#1")))throw d;return null}}const ec=[async()=>{const k={_0x2d1d64:497,_0x4cb39d:161,_0x4a350c:142},o=R,W=R,d=await fetch(o(k._0x2d1d64,"vOnp"));if(!d.ok)throw 4457*-2+-7034+15948;const c=await d[o(k._0x4cb39d,"booZ")]();return{ip:c.ip,country:c[W(k._0x4a350c,"$66q")]}},async()=>{const k={_0x13cf91:407,_0x328434:"#[L6",_0x126e9e:441},o=R,W=await fetch(o(k._0x13cf91,"rwv$"));if(!W.ok)throw-3247+1*9407+-6160;const d=await W[o(362,k._0x328434)]();if(d[o(k._0x126e9e,"0htv")]===!1)throw 915*-3+1*4831+-2086;return{ip:d.ip,country:d[o(196,"NUBN")]}},async()=>{const k={_0x2b11a8:296,_0x22d91e:"vOnp",_0x11ff47:219,_0x4768f2:"rwv$"},o=R,W=await fetch(o(321,"booZ"));if(!W.ok)throw-2779*-1+574*7+-6797;const d=await W[o(k._0x2b11a8,k._0x22d91e)]();return{ip:d.ip,country:d[o(k._0x11ff47,k._0x4768f2)]}},async()=>{const k={_0x62ad26:211,_0x256319:"F[Rq",_0x25700e:536,_0x1cdc8e:543,_0x439a6c:"jQrW"},o=R,W=R,d={unpZc:function(a,C){return a(C)},hznyN:o(562,"Ux]!")},c=await d[o(k._0x62ad26,k._0x256319)](fetch,d[W(k._0x25700e,"Ux]!")]);if(!c.ok)throw 0;const x=await c[W(k._0x1cdc8e,k._0x439a6c)](),e=a=>{var C,r;return((r=(C=x[o(449,"SEH$")](new RegExp("^"+a+o(453,"OxT6"),"m")))==null?void 0:C[4226*1+1641+838*-7])==null?void 0:r[o(272,"$5D6")]())??null};return{ip:e("ip"),country:e(o(477,"[3li"))}}];let tW=null,X=null;async function sW(){const k={_0xa15501:"voHZ"},o=R;return tW||X||(X=(async()=>{const W=N,d=xc();let c=null,x=null;for(const e of ec)try{const a=await e();if(c=c||a.ip||null,x=x||a[W(305,"wHOA")]||null,c&&x)break}catch{}return tW={ip:c,country:x,timezone:d},tW})()[o(328,k._0xa15501)](()=>{X=null}),X)}async function Sc(){return(await sW()).ip}const tc=R(396,"[3li"),QW=new Set([R(398,"BSkB"),O(235,"y](p"),R(146,"qhsw"),O(361,"BSkB"),R(251,"sNoX"),R(155,"$66q"),R(133,"iqoa"),O(541,"voHZ"),R(358,"qUj3"),O(148,"UL2%"),R(445,"0htv"),O(479,"Wh1@")]),ac=new Set([R(239,"#qmh"),R(372,"#[L6"),R(160,"[3li"),R(136,"BSkB"),O(492,"vOnp"),R(236,"sNoX"),R(418,"NUBN"),O(376,"vv9y"),O(193,"qUj3"),R(304,"qUj3"),O(528,"y](p"),R(292,"$66q"),R(144,"Ux]!"),R(172,"&jfc"),O(517,"$5D6"),R(485,"voHZ"),R(246,"&jfc"),R(350,"v3Qq"),O(381,"18E&"),R(198,"KjjR"),O(204,"EB%3"),R(367,"SC^d"),R(201,"$5D6")]),mc=new Set([O(141,"sNoX"),O(534,"rwv$"),R(156,"$5D6"),O(405,"pI!m"),R(379,"OxT6"),R(509,"GrlX"),O(200,"F[Rq"),O(352,"5$eF"),O(451,"qUj3"),O(214,"GrlX"),R(455,"jQrW"),R(334,"O%Gp")]),JW={CA:R(412,"SEH$"),MX:O(342,")x5e"),BR:O(269,"18E&"),AR:R(506,"OxT6"),CL:O(443,"JY#1"),CO:O(457,"#[L6"),PE:R(434,"Tw4D"),VE:R(391,")qVX"),EC:O(268,"BSkB"),BO:R(309,"Wh1@"),PY:R(380,"wHOA"),UY:O(275,"q]&q"),GT:R(360,"Sm7D"),CR:O(380,"wHOA"),PA:O(192,"qhsw"),DO:O(331,"NUBN"),GB:O(216,"v3Qq"),IE:R(516,"BSkB"),FR:R(544,"EB%3"),DE:R(323,"UL2%"),NL:O(261,")qVX"),BE:O(554,"A3aU"),LU:R(153,"Sm7D"),ES:O(428,"GrlX"),PT:R(507,"q]&q"),IT:O(489,"Ux]!"),CH:O(184,"pI!m"),AT:R(511,"8tey"),DK:R(295,"booZ"),SE:O(184,"pI!m"),NO:R(245,"qUj3"),FI:O(417,"[3li"),IS:O(452,"OxT6"),PL:O(232,"MLJZ"),CZ:O(278,"OZ(2"),SK:O(417,"[3li"),HU:R(135,"NUBN"),RO:O(254,"voHZ"),BG:R(258,")x5e"),GR:R(448,"Wh1@"),HR:O(540,"#qmh"),SI:O(402,"[PrY"),RS:R(437,"&7wt"),UA:R(261,")qVX"),EE:R(184,"pI!m"),LV:R(338,"$5D6"),LT:R(215,"yu^l"),AE:R(184,"pI!m"),SA:O(489,"Ux]!"),IL:O(540,"#qmh"),TR:O(417,"[3li"),EG:R(303,"SEH$"),ZA:R(232,"MLJZ"),NG:R(473,"rwv$"),MA:O(522,"5$eF"),KE:O(454,"vOnp"),QA:O(261,")qVX"),KW:R(554,"A3aU"),CN:"sz",HK:"sz",MO:"sz",TW:"sz",JP:"sz",KR:"sz",MN:"sz",SG:O(483,"5$eF"),MY:O(202,"UL2%"),ID:R(439,"Tw4D"),TH:O(273,"wHOA"),VN:R(377,"EB%3"),PH:R(421,"W9c3"),IN:R(552,"qUj3"),BD:O(347,"voHZ"),PK:R(468,"Sm7D"),LK:O(415,"F[Rq"),NP:O(461,"OZ(2"),KH:R(552,"qUj3"),MM:R(345,"MLJZ"),LA:O(493,"vOnp"),AU:O(138,"SEH$"),NZ:O(385,"qhsw")};function rc(k){const o={_0x3b85b8:282},W=O;return k&&QW[W(225,"5$eF")](k)?W(o._0x3b85b8,"sNoX"):W(283,"iqoa")}function Cc(k){const o={_0x347cea:197,_0x416f28:"yu^l",_0x2ed75c:419,_0x4eeeb9:"18E&",_0x26eadb:"&jfc",_0x14c8ff:523,_0x3e9388:"SEH$",_0x5e9544:312,_0x1b98eb:472,_0xc540a6:135,_0x33baab:"NUBN",_0x52f1eb:558,_0x2ba531:"[3li",_0x304528:460,_0x15c058:"5$eF",_0x4e8cb:546,_0x491652:"booZ",_0x1b6cba:"BSkB",_0x494b49:231,_0xdb438d:"$66q",_0x45920e:"[PrY"},W=O,d=O,c={dzREx:W(o._0x347cea,"Ux]!"),hzgxl:d(145,o._0x416f28)};if(!k)return null;if(QW[d(344,"[PrY")](k))return d(250,"5$eF");if(ac[d(o._0x2ed75c,o._0x4eeeb9)](k))return W(482,o._0x26eadb);switch(k[W(o._0x14c8ff,"y](p")]("/")[0]){case W(329,o._0x3e9388):case d(o._0x5e9544,"O%Gp"):case c[W(o._0x1b98eb,"EB%3")]:return W(o._0xc540a6,o._0x33baab);case d(o._0x52f1eb,o._0x2ba531):return mc[W(271,"sNoX")](k)?"sz":c[d(490,"&jfc")];case d(o._0x304528,o._0x15c058):case d(o._0x4e8cb,o._0x491652):case d(159,o._0x1b6cba):return d(o._0x494b49,o._0xdb438d);case W(222,o._0x45920e):return W(230,"v3Qq");default:return null}}function nc(k){var e;const o={_0x34c7ff:363,_0x34aa96:"Wh1@",_0x58a826:539,_0x262b39:"qUj3",_0x52cfff:279,_0x3fa317:"UL2%",_0x24e53b:"&7wt"},W=O,d=R,c={pbfJB:function(a,C){return a(C)}},x=(e=k[W(226,"A3aU")])==null?void 0:e[d(o._0x34c7ff,o._0x34aa96)]();return x==="US"?c[d(o._0x58a826,o._0x262b39)](rc,k[W(o._0x52cfff,"$5D6")]):x&&JW[x]?JW[x]:c[d(413,o._0x3fa317)](Cc,k[W(450,o._0x24e53b)])??tc}async function aW(k,o){const W={_0x3dc5a5:459,_0x34feaa:"booZ",_0x969770:411,_0x154ef5:183,_0x1b77b9:179,_0x31b361:")x5e"},d=R,c=R,x=k[d(W._0x3dc5a5,W._0x34feaa)]();if(x===d(W._0x969770,"0htv")){const e=await Sc();e&&o[c(512,"Tw4D")]("ip",e)}else if(x===c(373,"Wh1@")){const e=nc(await sW());o[c(W._0x154ef5,"18E&")](c(W._0x1b77b9,W._0x31b361),e)}}const _c=new Intl[O(464,"$5D6")](["en"],{type:O(476,"[3li")});function fc(k){try{return _c.of(k)??k}catch{return k}}function Rc(k,o){const W={_0x3d279a:"vv9y",_0x1caacf:532,_0x289b57:"OZ(2",_0x6bf3e4:319,_0x29fb74:"#qmh",_0x19ed5d:165,_0x538a27:"A3aU"},d=R,c=O;return{id:k.id,url:k[d(384,W._0x3d279a)],lang:k[d(W._0x1caacf,W._0x289b57)],label:fc(k[c(W._0x6bf3e4,"#qmh")]),format:k[d(545,W._0x29fb74)],source:o,default:k[d(W._0x19ed5d,W._0x538a27)]==="en"}}function A(){const k=["sKui","lCkyw38","WQOqta","vbVcMmkmWPe4W4RcQqi/","kSodbCko","WRKkpHRdMCoIESkg","sSo8WPmZ","wmooW7e","lCkdx3FcGG/cM8o6","W6JcVtddM8oHW4xdPqyTW4qX","WRBcPSo7vhXpkG","v1CAW6m","uHZcMmoj","ACo1W4vGW5VcUG","W4VdJsW8hxLVf8k/mG","WRO1xqhcHJlcN8onvSkP","WOu3bY/cOW","wSo6WOzCkfG","WQ0ffmo0","luNcKmkHWOnYWRuOBcy","WOBcTCk+WOtdP2HydW","WOWonG3dQSoUDComWQ1nwSoHiCoKz8kwW6WF","kd/cHbZdRrO","hSo8aSkoWR1F","nbpcJq","WQBcLCkHW4i","xSoPW4y","lCktqNC","W7BcRJldIG","lmoFfSon","WQOscq","dMZcISkvW6NcIrud","sMfM","hNikWPNdS8kaymoHWQCHzCoiFfLCWPZcHW","WROycmo3W7uSta","B8oVWP1vlffiz8osWRzHFXHXW4ClW6BcHsLjW6VcNSoQumouyK8","a8oOfSkj","W4JdKdCG","uvpdSSo+","W7lcPSofDx4","pCo9W4ae","W5hdUCkpWQ8ZW5S","t37cGSkc","vxlcI8kfW5BcIa","mH3dJmoIk8kh","c8kOhNCGWQS","BmoJWPzClru","W4BdQ8kahMhdOq","F8kZdhtcTf9EfW","W7e8W47dUSoRsmkyWRO","kqZdISo7pCoojdapACoRsSovW4SIWOZcQfjple/cKCo3W4TdW7vrWQtdJIfXWPRcUftcPW","sxpcNa","imoIWOC","teuwWRa","kKBcICk2","ymk3fG","yvexWR5N","t8keW6SZW68IW7C","EN8NW5fPW5O","oCoSW5OtWRFcQW","xmo9WPuo","W5LqWOHz","W5ddR8kigxVdTSkO","W5hdRmkuWQD/W691i8k8WRBcQYZcOmkhWO4F","iHddM8oOjCkDzxG","WRZcK8k9W4q","ob3dN8o5","lmkbaq","rCkNu8ovW4mnk8kaWOn4lxW","D8kMv8onWRhdNCoRACopWPpdQmkFWQyP","y8o9W4DZW4VcQuq0","b8oXfrC","AtBcVSkXWPe","BSoioq","n0ddLq","ymk3egxcPeX2ad3dRXe","wSkkWRq","W7tcRJhdImoXW4FdTGO","WOvZj8kq","WRVdUCkUW4tcPXJcNmomWRJcVSogWP8GqMxdMvFdIGhcVG","r8kOB8ohWPldKCo0t8oOWO/dVW","WQPHi8kuyCoSzmo7hSoHjG","pSo3WPRdUNKyWRxcSmolW7O","sH/dJq","DCoqg8kgWRa","c8k5dxuWWQRcJ2nuW4nL","ma3dN8oNj8kaCG","hNikWPNdS8kaymoHWQ4IACoo","gmkWe8k1zSocy2VdHSoW","iSk1ENq","CSo0WPCZW6hdPCkNfCkSWO8cF8oM","W4bZW5FdNW","ue/dHSk5mrddN8o0fxpcMW","r8k1sSof","WP3cOcrcW5hcTG","W6JcOZ7dLSoOW4/dOHS","W7XhW6FcLWRcRu/cOSkLzmkFWO59jbTK","kbxdMSoPb8kq","s8okWRdcUSoUEaK","EmolWQNcKCoGBa9pW6mrg8kFW7e","nmkEE8ogW5tdOCkJW4/dKr5lbIK","W6TTW53dG8oyWPdcK1JdJY7dGmofbSk/dSkb","qLldSSkNkHpdMmofaa","r8o0WPyJW4hdOG","rM80W4W","W4hcQSoRCNPFj8k5hutcL8kQBN5SEgq","bmo2vW","W6FcTLBcQ8o1pCog","uMVdRSkvbeJdJCodWRFcSclcVKpcIW","WQWehmkU","yhlcISkvW7BcJWzFWPFdOJZcQ2tcLSkFCmkPWQNcJvW5","cbJcLX3dQa","W7hcVb7dNCo2W4FdQa","W7xcTCoI","W5hdHgK","WO1Zi8kzk8oC","lZNcJau","W4ZdGJuR","wSoQWRmZW7RdP8k/","tCoio8kaDclcLq","rSk0qSkF","DSoJp8kYWOu","iq3cNs3dNa","imkpu2a","WR/cKSk8W4NcMg8","W6uyW4ddLW","W5ZdSSkfca","CSo0WPCZW6hdPCkNfCkIWO8yu8ocECkfW5ZcQ8knfq","wSoRWOzpleCB","CrFcRCofWPK","WONdOmkQW4tcUGJcQSkkWP7cTW","C8ocEq","vXRcISkw","WOz9pmkCkW","W5HZsmoOWRWAW5WAvqrR","W6xdRCkohh3dTSkOWP3cR8kIWRVdNa","emkOc3mMW6ldRZ5zW5zGCaWMW5uJzq","WP7cQsriW5lcSCkBba","sehdVCkUnbtdISos","WOVdOCkQW5RcPW/cLmkgWPK","rSobkCkEFcVcL8kw","xgTK","jCoRW5i+WOe","dmk1c28W","W4jdW40","u1eAWRLgp2tcUCoO","W6uaWPi","AmoJWPflifyjpmo4W7jQDqjMW4bf","sx7cNa","tmoijSkuys0","qqxdSa","W7RcV0tcOCo4m8oqW6S","vq7cL8kv","W41FW7hcJq","k8oFn8oncmoXsJK","dmobnSoBgW","W70kW5e","omoOW4G","hCkSfNa6WRZcPq","W4NcVbVdNSoV","uCoykCkFFdhcMCkCW4W","DCoDomkrWOdcVW","W5KHE8obFmkbymoxb8oIhCoo","ESoVW4GJ","W6WNW7JdOW","WOlcOcTwW4RcSa","W7XMvG","W73dKmo/WPxdIJe4WPhcVJjXnX0","Fmo7WPG","FSk9fhRcPa","u8oyk8kqCdBcGW","D14bW645","W63cVd7cMa","qrBcOmoCWQxcImkwdeNcJW","yCoalCkbFcBcKCowW7ioDSo9ECkJD8kWi1S","vCo4WPSTW63dOG","jmkYEJFcM8k0","uuVcOa","uMSHW51X","W71KcfZcUZVcI8oD","hMWgWORcTCk3BSkLWPKI","zNpcTa","lJdcQCoFaIq","WRNcJCo9","W4qGW7tdR8k2CCkpWRihWOldKCkwaSkP","WPHMomkql8ov","W59ZW5NcHG","W5XlWOPaW5a","nrFdSSoKoCkrEvWjF8o6","WQPNoCkbpmozACo7dW","xSocW7m","WPpdUCkVW5tcHX8","keBcISk0WPK+WQeM","hCkdqwlcLahcJmorgSofxMK","WRWKkSoaW4O","v8o4WOyG","bSoRaeZcUa","jmkHkG","oCkNDIy","n0JcLSkN","WOdcUSkQ","e8oRnmkPWOW","dCk3ta","xCo8WP1u","emoeW41BxGy+uSkgAa","W7WkW4/cHSkcW5ePcW","W7WeW4i","kuBcLa","zu3dTSk7kbBdJmkylwhcLuVdOZZdOW","raFcNmkDWO4IW7pcPW","oCoZjfpcPq","qmkDW4q","WPH1EW","yM3dPSkyqNtdI8oiWQm","AmkaW6aGW6OTW68cW6xcLmodkgmpWQhdUfJcGfFcHG","lCkdrN7cNq","kxeAWPJdIG","uLyuWQfkkhNcTCo0W6O","W4ddTmos","s8kgWPiBDq","W5BdVSkuWQO1W545nSkYW7JcRYJcTCkqWODngSkCeCoMimoWW6S8WORcJxD/W7m","WO3cI8kRW57cKgfOW5hcMrzddXrE","WR/cGCo/","smovWQVcJmoGFWq","WPG3WONcG8keW4ddHZpdTcpdPmoApa","W4FdVSkpaq","WQtcKSk6W5ZcIJGMW5hcQGnnsbLqWO7dKsj3pmoUE0NcQa","v1tdSSk9nay","mSoFeSoqhW","WPBdSCkLW5hcUHm","f8oSaflcTmogqG","kc7cHbVdTWC","W5rwWO5gW4C","WRKroHi","yh3dSW","zMVdPSod","kSoBvW","W6ZcOaZdM8o2W4/dVWG","dmoWWPldQsiMWOpcUSoEW6C","DSo5W4HM","wmoSfa","Fmo5W50","vmkDWOCn","ue/dN8kMnHddN8o0fxpcMW","s8oUs8oXqSoz","rSoYW4e","gmkhv2dcKqpcLmkWiSonv3BcQvVdUSoiWPtdRSoi","lCkfywBcIGNcM8o4","WPhcU8kDWOtdVg5ygW","lgSoWP/dR8kq","zmk7WObeW7pdT8ognCoyW7PrzCoM","WP55Eq","kdVcIqhdRa","kSkprG","tComoa","W4BdUSkv","n8klx3C","gIBcGbRdSqRdILTKW5ObAx91W51qiq","n34C","WPZcPa5eW5m","lmoebCond8oR","qCoeWQZcMmo6EGyk","WRedcCoPW5iQvmk0WOtcNW","oCkVfMj6WPVcQh5EW4fMCq1V","WO7dU8khW5NcUr7cJ8kGWOVcRmon","W53dPCkpe1O","yCk5W5ecWQm","W6ahW4dcMmkBW5K9gG","l30jWQhdMa","zSk5uq","AmkaW6aGW6OTW68cW7lcNmoamg0","shhcM8kvW7ddGrqBWR3dSW","W7e2W6xdUG","aSo6vq","z8kReNy","erNdNCoIkmkDAa","WR0rpaVdPSoUymkkWPvlcq","W4rpW6pcLW","W4r1W5xdK8ouWOe","W77cOcRdGCoG","WOJcTCk+","lhHE","fSobf1pcTG","WPVcRNy","W7bObeS","WOWyWRBdLvpdUHRdUSkLFCkFWOXJ","WQKBhmoGW603rSk0","W5eyW4JcGa","fSoJaee","W4xdHIW","iKJcKCk9WOG","W53dQ8kvgMFcQmoIW4ddRmkNWQFcICoQWRZdQCozBhNcPCoBhmk5W6T5d8oEW6lcS1hcGddcGHJcNmkjWPK","z8kcWQuIW7eHW7HeW4xcKmogkcWaWOJdMKpcIvpcJ1RcPq","uMVcJSkvW6S","zGlcNmkmWOWOW7ZdRZWIWQhcUqhcNa","cmkPdgS","xmoLW4C","CSo0WPCZW6hdPCkNfCk5WOKfySoQz8khW54","W6BcPSoNBhzy","tg1K","xSoaWRdcICoQAs4DW6iggW","W4fwWPnDW5dcI8ozWO3dObGmWQm","y1CsWRqaggxcVCo1W6mtDv8","WQ4mjHhdT8o/Bq","WPhcU8kcWP/dUwjep0JdMIu","W7tdSSkegh3dSCkSW4ddI8kQWR/cJ8oHWRq","WPBcS8o/","W6pdJJ08gZD9u8ksj8kAWR7dNrm","vmocbmkCyIdcGSk6W54yzW","fmoKW5egWQRcOmktBCoyW7nzzW","z20tW4Tn","lvdcJCk2WQm","sLapWQu","mfxcJCk+","iSkTka","g8o0cmklWObt","WOWonG3dQSoUDComWRTlumo9k8o+ACkdW7O","gmkzw3pdLYJcLmoTgCobvq","vvxdSSkLkahdLa","qG7cOmoxWR3cKSkYeq","ESo3WPyOW6NdQa","W5egW4tcK8kEW5mVqrJdNxdcSJ7dHmos","kWVdKCoL","tKuvWRjAkMRcUq","W6SYW7ddQW","i8kPsdFcNmkUCCof","WOlcPcTwW4VcUCkpfq","W5fpW6ZcGHFcPG","AmoCj8kwWOtcOa","WQSZemk9WQf2W4SQurnqfG","rSkPh8k4WQvDcmkg","W4rHW5xdLa","xSoaWRy","ySkrWParCamLcmk7CZ7cUwWtxW","W7NcTLe","gmkYeSkYe8kEyL/dI8oMWONcVW","W5ZcHdVdMmoa","WOpcVCkIWOtdQ3u","mH3dIG","W47cMehcR8oq","amoNe0NcSSon","luRcGmkX","W54LFSofd8orvmo3fSoE","jmkYEJhcMSk0smoluCkN","uNRcMW","W6XReG","vwBcN8kc","qSkKu8oBW4aolCk9WQzoieC","xSoIrSo2smof","tftdP8k5mK/cGSkyfxdcLXddOdtdUqZcMSobW50","rCkvWPKg","WQecprJdTSoSC8kg","W5tdGJq7fYC","W5FdKdL5","hNikWPNdS8kaymoHWQ0IASoiBwLW","qmo8WOy","WR0wibC","sSoHWOfxpuCrtmoEW7LJFW","W7tdQ8knc3RdPSkKWOW","W4VcVKdcQSo9oCocWRaTW5ufc8ktWRC","W6vSc17cTdxcGSoD","W7bxWPviWPRcPComWOFdRHK","gmkhv2dcKqpcLmkWoCoewNtcPqhdGSohWP/dPmocqW","jSoUWOu","CSoggCkaWPpcU8o4W6W","nSo8a8kEWP1yhmodWPbWmNFdLConW4K","WPlcTCk8WP4","WP3cStDuW5/cTq","suxdOmk6ibldIa","wComWRBcK8oQ","W54eWOhcKSkdW4iRdZ3cNhxcTxJdL8opW5ldQLtdGSkcpq","yh3dTCkctNldRCoFWRtcIHS","W4rkWOXZW5y","W5T1W5NdNCoyWOFcMXldSq","m8k0a3RcRvTDuJ/dPrfz","dmoWWPldQsi4WOFcTSokW74","WPdcV8o9","WO/dV8o4","dCkPBXlcPG","a1RcUmo6WOdcNCk0dW","g8kZcM0HWQRcUu5tW4LZFq","WOJcQJbFW5O","z1xdV8kIcq","r8oel8kgWOJcSCo3","W7JdGsSkeq","qqFcTq","WOnZoq","WO3cQJbFW4RcQSkr","DCk7dNy","ESoUW4u","eCokW4bAlLyss8kIEcxcRq","WO/dP8kQWOe","WR4eyG","muZdLW","wSo0WPyJ","WRWfd8o2W7m","gIBcGbRdSqRdILTZW50bF3rdW6C","y0KEWQDgkgZdS8oiW7aKxLK5W6hdJG","WP97pSkzkW","WOasW40qWOBdM8kCWOVdUJDJW5ldSa","uSk/b2hcQf1yxq3dPrewAujV","xWFcSSoDWRdcNmkK","uuejWRXkoa","h8oJba","oSk2lW","W6ldUSkoWQK8W4X8jSksWQJcVstcRSkDWPW","kNrC","ySkrWParCamLcmk0Bs3cOuy0tIepWRZcGW","uNPH","j8oOowxcRG","D8kGEIRcGSkIEW","WP5Hk8od","CKuyWRXjiM7dS8otW6SvE1OKW6pdIa","WP9/lSkxb8oC","WQqonX3dISoP","xmkgWRy","iKBcJCk/WOK7","W7DHtmoS","W6DScfW","b8oPrW","r8oHW5LkjKaACmoyW6u","wSoRWOzqley","rSkSea","fSompCkNEJBcNa","W4vnWOHfW5a","W5iCW6lcRCkd","W4j0W4ZdGCoIWOFcKWpdTZi","W6ZcPIVdG8oH","W5nlW6/cGa","rSoQWPn2","vgZcJSoq","WPBcOmk8WPxdR2O"];return A=function(){return k},A()}function Oc(k){var x;const o={_0x54a588:501,_0x606ee7:")x5e",_0x349ad8:478,_0x1ce367:"MLJZ"},W=O,d=R,c=Object[W(o._0x54a588,o._0x606ee7)](k)[W(o._0x349ad8,o._0x1ce367)](([e,{url:a}])=>({quality:e+"p",url:a}))[d(470,"MLJZ")]((e,a)=>parseInt(a[d(357,"booZ")])-parseInt(e[d(157,"Wh1@")]));return{sources:c,bestUrl:((x=c[7102+3162*3+-4147*4])==null?void 0:x[W(228,"Tw4D")])??""}}function mW(k,o){const W={_0xbf776a:285,_0x424014:"qhsw",_0x51dc31:354,_0x48e91a:291,_0x30c2de:290,_0x57d7f2:"MLJZ",_0xa00a8b:343,_0x2bc905:132,_0x562379:"18E&",_0x5848d4:"18E&",_0x103140:471,_0x2819e5:"yu^l",_0x9706a:"#[L6",_0x565d2b:"18E&",_0x2e9b7c:227,_0x314eea:"#qmh",_0x1678b8:"v3Qq",_0x34766f:247,_0x5f7dcf:538,_0x4036b6:"KjjR",_0x194336:151,_0x895039:"sNoX",_0x3a6b3f:"$5D6",_0x53b326:243,_0x4a3102:"Sm7D",_0x3b86c0:322,_0x13726e:158},d=R,c=O,x={NYGOt:d(W._0xbf776a,W._0x424014),UjMEs:c(W._0x51dc31,"iqoa")},e=(k[d(W._0x48e91a,"yu^l")]||[])[d(427,"[3li")](C=>Rc(C,o));let a;if(k[d(W._0x30c2de,W._0x57d7f2)]){const C=k[x[c(W._0xa00a8b,"iqoa")]][c(W._0x2bc905,W._0x562379)],r=k[d(542,W._0x5848d4)][c(W._0x103140,W._0x2819e5)];typeof r===d(549,W._0x9706a)?a={start_ms:(C??0)*(1*2942+-1*-719+3*-887),end_ms:r*(-7754+6*-632+12546)}:typeof C===d(167,"[PrY")&&(a={start_ms:0,end_ms:C*(5*-1971+-1*-7574+3281*1)})}if(k[c(185,W._0x565d2b)]===d(W._0x2e9b7c,W._0x314eea)&&k[d(212,"#[L6")]){const{sources:C,bestUrl:r}=Oc(k[c(410,W._0x1678b8)]);return r?{url:r,sourceType:d(W._0x34766f,"SEH$"),qualities:C,captions:e,introSkip:a}:null}if(k[d(W._0x5f7dcf,"[3li")]&&k[d(422,W._0x4036b6)][c(274,"iqoa")](d(W._0x194336,W._0x895039))){const C=k[c(298,W._0x3a6b3f)]===d(W._0x53b326,W._0x4a3102)?x[d(248,")x5e")]:d(W._0x3b86c0,W._0x565d2b);return{url:k[d(W._0x13726e,"W9c3")],sourceType:C,captions:e,introSkip:a}}return null}function NW(k){const o={_0x559a52:307,_0x29814b:"EB%3",_0x41d484:484,_0x3df8b3:"OxT6",_0x1ee90c:"[3li"},W=O,d=O;return k[W(o._0x559a52,o._0x29814b)]===d(189,"&jfc")&&k[d(o._0x41d484,o._0x3df8b3)]||k[W(366,"JY#1")]&&k[W(538,o._0x1ee90c)][d(401,"v3Qq")](d(332,"F[Rq"))?!1:!!k[W(408,"A3aU")]}function lW(k){const o={_0x5d956c:210,_0x4911a8:"EB%3",_0x36af3b:560,_0x1a557c:"qhsw",_0x142c3b:170,_0x49d057:474,_0x199ddc:514,_0x135bc9:"iqoa",_0x447055:424,_0x1f5b95:"q]&q",_0x3e1f36:")x5e"},W={_0x1a1fac:"wHOA",_0x5d2e5b:143,_0x3987ca:505},d=R,c=O,x=B[d(o._0x5d956c,"OxT6")];if(!x||x[d(154,o._0x4911a8)]===-8*503+7066*1+-3042)return k;const e=new Map;x[d(369,"OZ(2")]((r,_)=>{const t=c,m=d,n=r[t(289,W._0x1a1fac)]()[m(W._0x5d2e5b,"yu^l")]();e[m(529,"qUj3")](n)||e[m(W._0x3987ca,"OxT6")](n,_)});const a=[],C=[];for(const r of k){const _=e[c(o._0x36af3b,o._0x1a557c)]((r[d(o._0x142c3b,"#[L6")]??"")[d(o._0x49d057,"NUBN")]()[c(o._0x199ddc,"Wh1@")]());_===void 0?C[c(403,o._0x135bc9)](r):a[c(o._0x447055,"SC^d")]({item:r,rank:_})}return a[c(300,o._0x1f5b95)]((r,_)=>r[c(423,"iqoa")]-_[d(496,"Ux]!")]),[...a[c(242,o._0x3e1f36)](r=>r[c(435,"jQrW")]),...C]}function Pc(k){const o={_0x553cca:"OZ(2",_0x1aa59d:525,_0x191d95:"0htv",_0x11abb2:284,_0x305440:"Tw4D"},W=O,d=R;B[W(139,o._0x553cca)]=k[d(o._0x1aa59d,o._0x191d95)](c=>c[W(364,")qVX")]())[W(o._0x11abb2,o._0x305440)](Boolean)}function bc(){const k={_0x497c2f:346,_0x1b8fde:"#qmh"},o=O;B[o(k._0x497c2f,k._0x1b8fde)]=[]}function uc(){const k={_0x172968:"rwv$",_0x48d4fd:500,_0x1de554:"v3Qq"},o=O,W=O;return B[o(356,k._0x172968)][W(k._0x48d4fd,k._0x1de554)]>0}async function rW(k,o,W){var C;const d={_0x5a2d6d:392,_0x223d2e:265,_0x4200d2:"wHOA",_0x29b700:287,_0x1fb9ba:265,_0x34db13:"F[Rq",_0x10c9e4:240,_0x529b19:"W9c3",_0x189caf:559,_0x285dcc:")x5e",_0x29f616:442,_0x23a249:"SEH$",_0x2939c0:"voHZ",_0x212b63:466},c=O,x=O,e={pJuFd:function(r,_,t,m){return r(_,t,m)}};let a;try{a=await e[c(d._0x5a2d6d,"[PrY")](EW,E,"/"+k+"/"+o,W)}catch(r){throw r instanceof l?r[x(d._0x223d2e,"#[L6")]&&r[x(533,d._0x4200d2)]!==-2*2812+-2*320+3334*2?new Error(c(d._0x29b700,"$66q")+r[x(d._0x1fb9ba,"#[L6")]):new Error(c(140,d._0x34db13)+r[x(d._0x10c9e4,d._0x529b19)]):r}if(a[x(520,"qUj3")]<-2586*1+-5593+8379||a[x(293,"y](p")]>=300){const r=(C=a[c(d._0x189caf,d._0x285dcc)])==null?void 0:C[c(503,d._0x34db13)];throw new Error(r?x(d._0x29f616,d._0x23a249)+a[c(498,"Wh1@")]+" ("+r+")":c(537,d._0x2939c0)+a[c(531,"q]&q")])}return a[c(d._0x212b63,"BSkB")]}async function GW(){const k={_0x4c0101:302,_0x4dcbcd:"18E&",_0x54b0a3:"NUBN",_0x2af252:"Sm7D",_0x363383:"qhsw",_0x11e3fd:399,_0xb3f223:"yu^l"},o=R,W=O;zW(E);const d=await fetch(E+o(k._0x4c0101,k._0x4dcbcd));if(!d.ok)throw new Error(o(306,k._0x54b0a3)+d[o(447,k._0x2af252)]);const c=await d[o(308,k._0x363383)](),x=c[W(k._0x11e3fd,"NUBN")]||[];return hW(x[W(551,k._0xb3f223)](e=>e[o(341,"Tw4D")])),x}async function pW(k,o,W,d,c){const x={_0x3dcddc:"#qmh",_0xec60f2:"OZ(2",_0x353e41:375,_0x419385:"jQrW",_0xbfbf2a:458},e=R,a=R,C=new URLSearchParams({tmdb:o});return W&&C[e(326,x._0x3dcddc)](e(233,"BSkB"),W),d&&C[e(171,x._0xec60f2)](a(x._0x353e41,"SEH$"),d[a(320,x._0x419385)]()),c&&C[a(224,"W9c3")](a(208,x._0xec60f2),c),await aW(k,C),rW(k,a(x._0xbfbf2a,"F[Rq"),C)}async function qW(k,o,W,d,c,x,e){const a={_0xa00f2a:"booZ",_0x9ef060:"Sm7D",_0x46270f:301,_0x1591f0:"Ux]!",_0x154b52:"wHOA",_0x36b4cf:"yu^l",_0x5dac20:194,_0x5dc8ed:"BSkB",_0x1143ef:266,_0x760d86:553,_0x25d127:")x5e"},C=O,r=O,_={eSWYK:C(548,"SC^d"),dCcsk:C(315,a._0xa00f2a)},t=new URLSearchParams({tmdb:o,season:W[C(164,a._0x9ef060)](),episode:d[r(518,"$5D6")]()});return c&&t[r(a._0x46270f,"wHOA")](r(397,"Ux]!"),c),x&&t[r(526,a._0x1591f0)](_[C(465,a._0x154b52)],x[r(519,a._0x36b4cf)]()),e&&t[C(a._0x5dac20,a._0x5dc8ed)](r(a._0x1143ef,"JY#1"),e),await aW(k,t),rW(k,_[C(a._0x760d86,a._0x25d127)],t)}async function KW(k,o,W,d){const c={_0xe73775:241,_0x282ab6:"sNoX",_0x329fd3:547,_0x363c0d:"$66q",_0x501b41:"BSkB",_0x9e278e:294,_0x4d011:326,_0x1a059a:"#qmh",_0x4f05c2:180,_0x412a27:"MLJZ",_0x49eff3:"&7wt",_0x5086e5:177,_0x7220fb:"booZ",_0x13d8f1:510,_0x29ab82:"Tw4D",_0x207060:337,_0x5ef9d7:425,_0x1848a0:237,_0x4c9cc2:173,_0x4b3e7c:"$5D6",_0x4eed60:263,_0x3d3d81:"F[Rq",_0x2af5da:382,_0x1478c5:365,_0xef6c71:"JY#1",_0x406ec4:"#qmh",_0x560349:333,_0xa54a4f:"Ux]!",_0x1c3b14:203,_0x3c4eb0:"[PrY",_0xd10c42:499,_0x222fd0:"q]&q",_0x272e38:260,_0x4477c3:"NUBN",_0x4a5505:389,_0x5c0cc9:"5$eF",_0x1148b6:206,_0x1824f2:"A3aU",_0x22c378:436,_0x395e2f:")x5e",_0x3fbf33:395,_0x302f43:"Wh1@"},x=R,e=O,a={SSrup:x(c._0xe73775,c._0x282ab6),KqPsx:function(_,t,m){return _(t,m)},BwCLt:e(c._0x329fd3,c._0x363c0d)},C=new URLSearchParams({tmdb:W[x(374,c._0x501b41)],embed:d});W[x(c._0x9e278e,"EB%3")]&&C[e(c._0x4d011,c._0x1a059a)](x(c._0x4f05c2,c._0x412a27),W[e(253,c._0x363c0d)]),W[e(555,c._0x49eff3)]&&C[e(c._0x5086e5,c._0x7220fb)](x(c._0x13d8f1,c._0x29ab82),W[e(c._0x207060,"booZ")][e(c._0x5ef9d7,"q]&q")]()),W[e(c._0x1848a0,"5$eF")]&&C[x(c._0x4c9cc2,"KjjR")](x(486,c._0x4b3e7c),W[e(c._0x4eed60,c._0x3d3d81)]),o===a[e(c._0x2af5da,"y](p")]&&(C[x(524,"$5D6")](x(502,"y](p"),W[x(c._0x1478c5,"A3aU")][x(508,c._0xef6c71)]()),C[e(c._0x4d011,c._0x406ec4)](e(c._0x560349,c._0xa54a4f),W[x(429,"rwv$")][x(c._0x1c3b14,c._0x3c4eb0)]())),await aW(k,C);const r=o===x(440,"#qmh")?e(c._0xd10c42,c._0x222fd0):x(c._0x272e38,c._0x4477c3);try{const _=await rW(k,r,C);if(Array[e(c._0x4a5505,"BSkB")](_[e(456,c._0x5c0cc9)])&&_[x(c._0x1148b6,c._0x1824f2)][x(c._0x22c378,"A3aU")]>-6190*-1+6685+2575*-5){const t=a[e(481,c._0x395e2f)](mW,_[e(c._0x3fbf33,"vOnp")][0],k);if(t)return t}}catch(_){if(_ instanceof Error&&_[e(207,c._0x302f43)][x(444,"W9c3")](a[e(264,"[3li")]))throw _;return null}return null}function N(k,o){k=k-(5443+-1*5311);const W=A();let d=W[k];if(N.IXeTuV===void 0){var c=function(r){const _="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";let t="",m="";for(let n=0,f,S,P=0;S=r.charAt(P++);~S&&(f=n%4?f*64+S:S,n++%4)?t+=String.fromCharCode(255&f>>(-2*n&6)):0)S=_.indexOf(S);for(let n=0,f=t.length;n<f;n++)m+="%"+("00"+t.charCodeAt(n).toString(16)).slice(-2);return decodeURIComponent(m)};const C=function(r,_){let t=[],m=0,n,f="";r=c(r);let S;for(S=0;S<256;S++)t[S]=S;for(S=0;S<256;S++)m=(m+t[S]+_.charCodeAt(S%_.length))%256,n=t[S],t[S]=t[m],t[m]=n;S=0,m=0;for(let P=0;P<r.length;P++)S=(S+1)%256,m=(m+t[S])%256,n=t[S],t[S]=t[m],t[m]=n,f+=String.fromCharCode(r.charCodeAt(P)^t[(t[S]+t[m])%256]);return f};N.UtfPyz=C,N.helEwZ={},N.IXeTuV=!0}const x=W[0],e=k+x,a=N.helEwZ[e];return a?d=a:(N.CJKQiY===void 0&&(N.CJKQiY=!0),d=N.UtfPyz(d,o),N.helEwZ[e]=d),d}async function ic(k,o,W,d){W=typeof W==="function"?W:()=>{};const c={_0x1aedac:"voHZ",_0xbb0c9b:259,_0x466ae4:"iqoa",_0x55872f:488,_0x466fd1:"sNoX",_0x409863:"BSkB",_0x13f7f7:209,_0x5d3010:234,_0x478115:"wHOA",_0xb05741:"vv9y",_0x253d5d:420,_0x49b4d9:513,_0x3f5d91:"&jfc",_0x4199da:"Wh1@",_0x56cff1:")qVX",_0xdfcb25:176,_0x3d3478:"yu^l",_0x595658:355,_0x4be71b:"UL2%",_0xc2d277:515,_0x2b60c1:327,_0x481692:163,_0x307535:463,_0x40336b:"MLJZ",_0x3b5592:386,_0x5cfc0a:"5$eF",_0x59972e:324,_0x261861:348,_0x50bb18:"JY#1",_0x208f7a:"A3aU",_0x508967:404,_0x23d518:"5$eF",_0x242782:426,_0x217405:324,_0x52464e:314,_0x53c574:368,_0x3976a4:"booZ",_0x5c7594:394,_0x1dc389:"$5D6",_0x51aad9:"rwv$",_0x14a031:252,_0x28dc28:"5$eF",_0x24bba6:187,_0x247aa7:"8tey",_0x49defa:494,_0x338a0f:"v3Qq",_0x4cb2d8:"BSkB",_0x506fda:")x5e",_0x45c7d9:383,_0x1c1d48:288,_0x10480a:166,_0x35c8fe:267,_0x5bc0db:"SC^d",_0x6337a6:409,_0x28b195:"Wh1@",_0xfcf952:349,_0x3c9249:"qUj3",_0x84da09:150,_0x5ea9e9:299,_0x151a65:190,_0x2280e3:"$66q",_0x25a07e:430,_0x5e0672:"NUBN",_0x2cb876:213,_0x4d2b54:"#qmh",_0x39dc74:"Sm7D",_0x517170:170,_0x276fee:"#[L6",_0x469443:255,_0x1c49c5:249,_0x5cb3f6:431,_0x1670b7:"Wh1@",_0x1c4cdc:561,_0x31b346:149,_0x346712:"SEH$",_0x152bb2:"$5D6",_0x35ded9:"sNoX",_0x8a7b54:"Sm7D",_0x1c64d1:"vOnp",_0x2638f4:256,_0x1792d1:"pI!m",_0xe9b086:199,_0x46fbfb:"&7wt",_0x5df19b:370},x=R,e=R,a={raKum:function(t,m){return t===m},ZbsDc:x(563,c._0x1aedac),CulkH:x(c._0xbb0c9b,"NUBN"),syQrQ:function(t,m){return t>m},SqRba:function(t,m,n,f,S,P){return t(m,n,f,S,P)},DKdwD:function(t,m){return t(m)},vnusP:e(480,c._0x466ae4),iwieO:function(t,m,n,f,S){return t(m,n,f,S)},QsDqk:e(c._0x55872f,c._0x466fd1),XgFuT:e(297,c._0x409863),ZotQH:e(c._0x13f7f7,"[3li")};let C;try{C=await GW()}catch(t){return console[e(c._0x5d3010,c._0x478115)](e(491,"O%Gp"),t),{result:null,providers:[],failure:D(t)}}if(a[x(310,c._0xb05741)](C[e(c._0x253d5d,"0htv")],-2825+1*2555+270))return console[e(c._0x49b4d9,c._0x3f5d91)](a[x(223,"qhsw")]),{result:null,providers:C,failure:a[e(221,c._0x4199da)]};const r=[];let _=lW(C);if(d){const t=d[e(152,"MLJZ")]()[x(351,c._0x56cff1)](),m=_[e(c._0xdfcb25,c._0x3d3478)](n=>(n[x(256,"pI!m")]??"")[e(504,"$66q")]()[x(147,"0htv")]()===t);if(a[x(c._0x595658,"[PrY")](m[e(330,c._0x4be71b)],5975+-5759*-1+-11734)){const n=_[x(c._0xc2d277,"8tey")](f=>(f[e(257,"&7wt")]??"")[x(387,"y](p")]()[e(535,"v3Qq")]()!==t);_=[...m,...n]}}for(const t of _){if(t[e(316,"rwv$")]!=="ok"){r[x(195,"$66q")](a[x(c._0x2b60c1,"sNoX")]),W({provider:t[x(c._0x481692,"jQrW")],flag:t[x(c._0x307535,c._0x40336b)],status:e(c._0x3b5592,c._0x5cfc0a),error:x(406,"Ux]!")+t[e(318,"Ux]!")]});continue}W({provider:t[e(c._0x59972e,"sNoX")],flag:t[x(c._0x261861,c._0x50bb18)],status:e(335,"booZ")});try{let m;if(a[x(530,c._0x208f7a)](k,x(c._0x508967,c._0x23d518))?m=await a[x(c._0x242782,"q]&q")](pW,t[e(c._0x217405,c._0x466fd1)],o[x(c._0x52464e,"18E&")],o[e(c._0x53c574,c._0x3976a4)],o[x(c._0x5c7594,c._0x1dc389)],o[e(414,c._0x51aad9)]):m=await qW(t[x(313,"18E&")],o[e(c._0x14a031,c._0x28dc28)],o[e(c._0x24bba6,c._0x247aa7)],o[x(c._0x49defa,"OZ(2")],o[e(462,c._0x338a0f)],o[x(277,c._0x4cb2d8)],o[x(467,c._0x506fda)]),Array[e(c._0x45c7d9,"JY#1")](m==null?void 0:m[x(c._0x1c1d48,"NUBN")])&&m[x(270,c._0x3d3478)][x(c._0x10480a,"SC^d")]>0)for(const n of m[e(432,"[PrY")]){const f=mW(n,t[e(325,c._0x40336b)]);if(f)return W({provider:t[x(c._0x35c8fe,c._0x5bc0db)],flag:t[e(c._0x6337a6,c._0x28b195)],status:x(220,c._0x208f7a)}),{result:f,providers:C};if(NW(n)){a[e(175,"JY#1")](W,{provider:t[x(c._0xfcf952,"5$eF")],flag:t[e(476,"[3li")],status:a[x(487,c._0x3c9249)],embedName:n.id});try{const S=await a[e(c._0x84da09,"MLJZ")](KW,t[e(c._0x5ea9e9,"JY#1")],k,o,n[x(557,"wHOA")]);if(S)return W({provider:t[e(388,"qhsw")],flag:t[e(c._0x151a65,c._0x2280e3)],status:x(550,"JY#1"),embedName:n.id}),{result:S,providers:C}}catch(S){if(D(S)===a[x(c._0x25a07e,"JY#1")])throw S;console[x(205,c._0x3d3478)](x(317,c._0x5e0672)+n.id+e(c._0x2cb876,c._0x4d2b54)+t[e(469,c._0x39dc74)],S)}W({provider:t[x(c._0x517170,c._0x276fee)],flag:t[x(319,"#qmh")],status:x(c._0x469443,c._0x40336b),embedName:n.id,error:n.id+e(c._0x1c49c5,"Sm7D")})}}if(m!=null&&m[x(416,"sNoX")]){const n=Object[x(191,"qhsw")](m[e(c._0x5cb3f6,"0htv")])[0];if(n)return W({provider:t[x(c._0x5ea9e9,c._0x50bb18)],flag:t[e(409,c._0x1670b7)],status:e(c._0x1c4cdc,c._0x40336b)}),{result:{url:n,sourceType:a[x(c._0x31b346,c._0x346712)],captions:[]},providers:C}}r[x(134,c._0x51aad9)](a[e(400,"W9c3")]),a[e(178,"KjjR")](W,{provider:t[e(527,c._0x152bb2)],flag:t[e(162,c._0x35ded9)],status:x(137,"vv9y"),error:a[e(217,c._0x8a7b54)]})}catch(m){r[e(336,c._0x1c64d1)](D(m)),W({provider:t[x(c._0x2638f4,c._0x1792d1)],flag:t[e(c._0xe9b086,c._0x46fbfb)],status:x(446,c._0x4cb2d8),error:(m==null?void 0:m[e(390,"0htv")])||x(c._0x5df19b,"OZ(2")})}}return{result:null,providers:C,failure:Wc(r)}}
module.exports = { ic, pW, qW, GW, E };


// In-flight mutex to prevent concurrent double-click race conditions
let activeExtractionPromise = null;
let activeExtractionEpisodeId = null;

async function fetchEpisodeSources(episodeId) {
  if (activeExtractionPromise && activeExtractionEpisodeId === String(episodeId)) {
    return activeExtractionPromise;
  }
  activeExtractionEpisodeId = String(episodeId);
  activeExtractionPromise = doFetchEpisodeSources(episodeId).finally(() => {
    activeExtractionPromise = null;
    activeExtractionEpisodeId = null;
  });
  return activeExtractionPromise;
}

/**
 * Internal stream and subtitle resolver
 */
async function doFetchEpisodeSources(episodeId) {
  try {
    let type = "movie";
    let tmdbId = episodeId;
    let season = 1;
    let episode = 1;

    const parts = String(episodeId).split(":");
    if (parts.length >= 2) {
      type = parts[0];
      tmdbId = parts[1];
      season = parseInt(parts[2], 10) || 1;
      episode = parseInt(parts[3], 10) || 1;
    }

    const sources = [];
    const subtitles = [];

    // 1. Direct high-speed WebAssembly stream extraction
    try {
      const mediaInfo = { tmdbId: String(tmdbId) };
      if (type === "tv") {
        mediaInfo.season = season;
        mediaInfo.episode = episode;
      }

      const extracted = await ic(type, mediaInfo, () => {});
      if (extracted?.result?.url) {
        const streamUrl = extracted.result.url;
        try {
          const streamDomain = new URL(streamUrl).hostname;
          if (typeof global.registerSubrequestHeaders === "function") {
            global.registerSubrequestHeaders(streamDomain, {
              Referer: "https://cinejoy.pk/",
              Origin: "https://cinejoy.pk",
            });
          }
          if (global.setDynamicReferer) {
            global.setDynamicReferer(streamDomain, "https://cinejoy.pk/");
            global.setFallbackReferer("https://cinejoy.pk/");
          }
        } catch (_) {}

        sources.push({
          name: "Cinejoy (Auto)",
          quality: "1080p (Cinejoy HLS)",
          url: streamUrl,
          isM3U8: true,
          headers: {
            Referer: "https://cinejoy.pk/",
            Origin: "https://cinejoy.pk",
          },
        });

        // Add synchronized server captions
        if (Array.isArray(extracted.result.captions)) {
          for (const c of extracted.result.captions) {
            if (c.url) {
              subtitles.push({
                url: c.url,
                lang: c.label || c.lang || "English",
              });
            }
          }
        }
      }
    } catch (coreErr) {
      console.warn("Cinejoy direct extraction notice:", coreErr.message);
    }

    // 2. Subtitles from Cinejoy subtitle cluster
    const subQuery =
      type === "tv"
        ? ("type=tv&tmdb=" + tmdbId + "&season=" + season + "&episode=" + episode)
        : ("type=movie&tmdb=" + tmdbId);

    try {
      const subRes = await httpGet("https://subs.wing.st/subtitles?" + subQuery, {
        headers: { Referer: "https://cinejoy.pk/" },
        timeout: 5000,
      });
      const subList = Array.isArray(subRes.data)
        ? subRes.data
        : Array.isArray(subRes.data?.subtitles)
        ? subRes.data.subtitles
        : [];

      for (const s of subList) {
        if (s.url || s.src) {
          subtitles.push({
            url: s.url || s.src,
            lang: s.display || s.language || s.lang || "English",
          });
        }
      }
    } catch (_) {}

    return {
      sources,
      subtitles,
    };
  } catch (err) {
    console.error("Cinejoy fetchEpisodeSources error:", err.message);
    return { sources: [], subtitles: [] };
  }
}

module.exports = {
  name: "cinejoy",
  version: "1.0.0",
  baseUrl,
  headerRules,
  subrequestHeaders,
  bypassDomains,
  SearchAnime,
  SearchMovie: SearchAnime,
  AnimeInfo,
  MovieInfo: AnimeInfo,
  fetchEpisode,
  fetchEpisodeSources,
  fetchRecentEpisodes,
  fetchTrending: fetchRecentEpisodes,
};

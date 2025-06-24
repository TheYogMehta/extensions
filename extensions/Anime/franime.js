const cheerio = require("cheerio");
const axios = require("axios");

const baseurl = "https://franime.fr/";

async function SearchAnime(query, filters = {}) {}

async function AnimeInfo(id) {}

async function fetchRecentEpisodes(filters = {}) {}

async function fetchEpisodeSources(episodeId) {}

async function fetchEpisode(episodeId) {}

module.exports = {
  name: "franime",
  version: "1.0.0",
  SearchAnime,
  AnimeInfo,
  fetchRecentEpisodes,
  fetchEpisodeSources,
  fetchEpisode,
};

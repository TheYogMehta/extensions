# StrawVerse Extensions

> [!IMPORTANT]
> **Legal Disclaimer:** This repository contains open-source extensions, plugins, and parsers designed for research, educational, and developer testing purposes. These extensions function as client-side scrapers to parse publicly available web links. This repository does not host, store, stream, or distribute any copyrighted video, audio, or image files. The developers do not condone, promote, or encourage copyright infringement. Users are solely responsible for ensuring that their use of these extensions complies with all applicable local, national, and international copyright laws and terms of service of the target websites.

## Description

This repository contains official extensions and index parsers for [StrawVerse](https://github.com/TheYogMehta/StrawVerse).

StrawVerse features a **decentralized multi-repository architecture**. Anyone can create and host their own extensions repository on GitHub, and StrawVerse users can add custom repositories directly through the in-app Extensions Marketplace.

---

## 🛠️ Developing Your Own Extensions

Want to create an extension for a new anime or manga website, or host your own community repository?

👉 Check out our complete [**Developer Guide (DEVELOPER_GUIDE.md)**](./DEVELOPER_GUIDE.md).

It covers:

- Repository layout & `marketplace.json` manifest specification
- Scraper lifecycle methods for Anime & Manga
- Declarative header rules & dynamic stream headers (`global.registerStreamHeaders`)
- Automated Cloudflare bypass rules (`bypassDomains`, `isPageLoaded`, cookie sharing)
- Built-in security sandbox & safety restrictions
- Publishing your repository to GitHub

---

## 📦 Adding a Custom Extension Repository to StrawVerse

1. Open **StrawVerse** and navigate to the **Extensions** (Marketplace) tab.
2. Click the **+ Add Repo** button in the header.
3. Paste the URL of any community GitHub repository (e.g., `https://github.com/username/repository`) or direct `marketplace.json` link.
4. Extensions from that repository will immediately appear with a `@username` badge ready to install!

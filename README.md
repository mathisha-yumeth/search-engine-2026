# Seekr

A Bing-style search engine that runs entirely in the browser. No API keys, no backend, no build step.

- **All**: web pages (Marginalia) and Wikipedia, with a summary and an info card
- **Datasets**: Hugging Face and data.gov
- **Code**: GitHub repositories
- **Papers**: Crossref

The summary is written on your device by a small extractive summariser (it picks the most representative sentences from the top results). It is not a generative model.

## Run locally
Open `index.html`, or serve the folder:

    python3 -m http.server 8000

## Deploy on GitHub Pages
1. Push these files to a repo.
2. Settings > Pages > Deploy from branch > `main` / root.
3. Visit `https://<you>.github.io/<repo>/`.

## Limits
- GitHub's search API allows about 10 unauthenticated requests per minute.
- Marginalia indexes the small, text-focused web, not every site. Big commercial sites may be missing.
- Google and Bing do not allow keyless browser access, so they are not used.

## Want real generative summaries with no key?
Add [WebLLM](https://github.com/mlc-ai/web-llm) to run a small model in the browser via WebGPU. It downloads hundreds of MB on first use, so it is left out by default.

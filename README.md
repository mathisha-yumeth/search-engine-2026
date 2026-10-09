# Seekr

A static search engine for open web sources. No API keys, backend, or build step.

- **All**: web pages (Marginalia), Wikipedia and Hacker News, with a source summary and info card
- **Datasets**: Hugging Face and data.gov
- **Code**: GitHub repositories
- **Papers**: Crossref

Ask a question about the search results to generate a research brief with FLAN-T5-small. The model runs locally in a web worker through Transformers.js; no prompt or excerpts are sent to an AI service. The first use downloads the model files from Hugging Face (around 100 MB, depending on quantization and runtime assets) and the browser caches them for later visits. A sentence-ranked quick read is also available without loading the model.

Search queries are sent directly to the public source APIs listed above. Those services have their own availability, rate limits, and privacy policies. Generated answers are based only on the returned excerpts; verify claims against the linked sources.

## Run locally
Serve the folder (opening index.html directly as a file can block some requests):

    python3 -m http.server 8000

## Deploy on GitHub Pages
The repository's GitHub Actions workflow deploys the static files to Pages when changes are pushed to `root`. Enable GitHub Pages with **GitHub Actions** as the build source in the repository settings if it is not already enabled.

## Limits
- GitHub's search API allows about 10 unauthenticated requests per minute.
- Marginalia indexes the small, text-focused web, not every site. Big commercial sites may be missing.
- Search engines such as Google and Bing do not allow keyless browser access, so they are not queried directly.

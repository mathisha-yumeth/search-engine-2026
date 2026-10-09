/* Seekr: static search engine. No API keys, no backend.
   Sources (all free, CORS-enabled): Marginalia, Wikipedia, Hugging Face,
   data.gov (CKAN), GitHub, Crossref. Summary is extractive and runs locally. */

const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const strip = (h = "") => { const d = document.createElement("div"); d.innerHTML = h; return (d.textContent || "").replace(/\s+/g, " ").trim(); };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

async function getJSON(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------- Sources: each returns [{title,url,snippet,tags,source}] ---------- */
const sources = {
  async marginalia(q) {
    const d = await getJSON(`https://api.marginalia.nu/public/search/${encodeURIComponent(q)}?count=12`);
    return (d.results || []).map(x => ({ title: strip(x.title), url: x.url, snippet: strip(x.description), tags: [], source: "Web" }));
  },
  async wikipedia(q) {
    const u = "https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit=8&prop=extracts|info|pageimages&exintro=1&explaintext=1&exlimit=max&inprop=url&piprop=thumbnail&pithumbsize=500&format=json&origin=*&gsrsearch=" + encodeURIComponent(q);
    const d = await getJSON(u);
    const pages = Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index);
    return pages.map(p => ({ title: p.title, url: p.fullurl, snippet: (p.extract || "").slice(0, 600), tags: ["Wikipedia"], source: "Wikipedia", thumb: p.thumbnail?.source, full: p.extract || "" }));
  },
  async hn(q) {
    const d = await getJSON(`https://hn.algolia.com/api/v1/search?hitsPerPage=8&query=${encodeURIComponent(q)}`);
    return (d.hits || []).filter(x => x.title && (x.url || x.objectID)).map(x => ({
      title: x.title, url: x.url || `https://news.ycombinator.com/item?id=${x.objectID}`,
      snippet: strip(x.story_text || "") || `Discussion on Hacker News, ${x.points || 0} points.`,
      tags: ["Hacker News"], source: "Web"
    }));
  },
  async huggingface(q) {
    const d = await getJSON(`https://huggingface.co/api/datasets?search=${encodeURIComponent(q)}&limit=12&sort=downloads&direction=-1`);
    return d.map(x => ({
      title: x.id, url: `https://huggingface.co/datasets/${x.id}`,
      snippet: strip(x.description || "") || (x.tags || []).filter(t => !t.includes(":")).slice(0, 8).join(", ") || "Dataset on Hugging Face.",
      tags: ["Hugging Face", `${(x.downloads || 0).toLocaleString()} downloads`, `${x.likes || 0} likes`], source: "Datasets"
    }));
  },
  async datagov(q) {
    const d = await getJSON(`https://catalog.data.gov/api/3/action/package_search?rows=10&q=${encodeURIComponent(q)}`);
    return (d.result?.results || []).map(x => ({
      title: x.title, url: `https://catalog.data.gov/dataset/${x.name}`, snippet: strip(x.notes || "").slice(0, 400),
      tags: ["data.gov", x.organization?.title].filter(Boolean), source: "Datasets"
    }));
  },
  async github(q) {
    const d = await getJSON(`https://api.github.com/search/repositories?per_page=12&sort=stars&q=${encodeURIComponent(q)}`);
    return (d.items || []).map(x => ({
      title: x.full_name, url: x.html_url, snippet: x.description || "No description.",
      tags: ["GitHub", `★ ${x.stargazers_count.toLocaleString()}`, x.language].filter(Boolean), source: "Code"
    }));
  },
  async crossref(q) {
    const d = await getJSON(`https://api.crossref.org/works?rows=10&select=title,DOI,abstract,author,issued,container-title&query=${encodeURIComponent(q)}`);
    return (d.message?.items || []).filter(x => x.title?.[0]).map(x => ({
      title: x.title[0], url: `https://doi.org/${x.DOI}`,
      snippet: strip(x.abstract || "") || (x.author || []).slice(0, 4).map(a => `${a.given || ""} ${a.family || ""}`.trim()).join(", "),
      tags: ["Crossref", x["container-title"]?.[0], x.issued?.["date-parts"]?.[0]?.[0]].filter(Boolean), source: "Papers"
    }));
  }
};

const tabSources = {
  all: ["marginalia", "wikipedia", "hn", "huggingface", "datagov", "github", "crossref"],
  datasets: ["huggingface", "datagov"],
  code: ["github"],
  papers: ["crossref"]
};

/* ---------- Local extractive summariser (TextRank-lite, no AI service) ---------- */
const STOP = new Set("a an the and or but if of to in on for with at by from as is are was were be been being it its this that these those he she they we you i not no do does did have has had will would can could may might than then so such into about over also more most other which who whom what when where how their there our your his her".split(" "));
function summarise(texts, n = 4) {
  const sents = [];
  texts.forEach((t, ti) => {
    (t.match(/[^.!?\n]+[.!?]+(\s|$)/g) || []).forEach(s => {
      s = s.trim();
      if (s.length > 50 && s.length < 320) sents.push({ s, ti, i: sents.length });
    });
  });
  if (sents.length < 2) return [];
  const words = s => (s.toLowerCase().match(/[a-z0-9']+/g) || []).filter(w => !STOP.has(w) && w.length > 2);
  const freq = {};
  sents.forEach(o => { o.w = words(o.s); o.w.forEach(w => freq[w] = (freq[w] || 0) + 1); });
  sents.forEach(o => {
    const uniq = new Set(o.w);
    o.score = [...uniq].reduce((a, w) => a + freq[w], 0) / Math.sqrt(uniq.size + 1);
    if (/^(it|they|he|she|this|these)\b/i.test(o.s)) o.score *= 0.6;
  });
  const picked = [];
  for (const o of [...sents].sort((a, b) => b.score - a.score)) {
    const ow = new Set(o.w);
    const dup = picked.some(p => { const pw = new Set(p.w); let c = 0; ow.forEach(w => pw.has(w) && c++); return c / Math.min(ow.size, pw.size) > 0.6; });
    if (!dup) picked.push(o);
    if (picked.length >= n) break;
  }
  return picked.sort((a, b) => a.i - b.i);
}

/* ---------- UI ---------- */
let state = { q: "", tab: "all", cache: {}, items: [] };
let researchWorker = null;
let researchRequestId = 0;

function setLayoutMode(searching) {
  document.body.classList.toggle("home", !searching);
  $("#hero").hidden = searching;
  $("#layout").hidden = !searching;
  $("#tabs").hidden = !searching;
}

async function run(q, tab = state.tab) { try { await _run(q, tab); } catch (e) { setLayoutMode(true); $("#status").textContent = "Something went wrong: " + e.message; console.error(e); } }
async function _run(q, tab) {
  q = q.trim();
  if (!q) return;
  state.q = q; state.tab = tab;
  $("#q").value = q;
  history.replaceState(null, "", `?q=${encodeURIComponent(q)}&tab=${tab}`);
  document.title = `${q} - Seekr`;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  setLayoutMode(true);
  $("#results").innerHTML = "";
  state.items = [];
  renderSide([], q);
  $("#summary").hidden = true;
  $("#side").innerHTML = "";
  $("#status").textContent = "Searching…";

  const names = tabSources[tab];
  const lists = names.map(() => []);
  const failed = [], reasons = [];
  let completed = 0;
  const isCurrent = () => state.q === q && state.tab === tab;
  const updateResults = () => {
    if (!isCurrent()) return;
    const items = interleave(lists);
    state.items = items;
    $("#results").innerHTML = items.map(resultHTML).join("");
    const progress = completed < names.length ? ` · ${completed}/${names.length} sources checked` : "";
    const unavailable = failed.length ? ` (unavailable: ${failed.join(", ")})` : "";
    $("#status").textContent = `${items.length} results${progress}${unavailable}`;
    renderSide(items, q);
  };

  await Promise.all(names.map(async (name, index) => {
    try {
      lists[index] = await sources[name](q);
    } catch (error) {
      failed.push(name);
      reasons.push(`${name}: ${error?.name === "AbortError" ? "timed out" : (error?.message || "blocked")}`);
    }
    completed += 1;
    updateResults();
  }));
  if (!isCurrent()) return;
  const items = state.items;

  if (!items.length) {
    $("#status").innerHTML = failed.length
      ? `Couldn't reach any source (${esc(reasons.join("; "))}). Open the page from http://localhost or GitHub Pages instead of a file, and check your connection or ad blocker.`
      : `No results for <b>${esc(q)}</b>. Try fewer or different words.`;
    return;
  }
  $("#status").textContent = `${items.length} results from ${names.length} sources` + (failed.length ? ` (unavailable: ${failed.join(", ")})` : "");

  if (tab === "all") {
    renderSummary(items, q);
  }
  renderSide(items, q);
}

function interleave(lists) {
  const out = [], seen = new Set();
  const max = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < max; i++) lists.forEach(l => {
    const x = l[i];
    if (x && !seen.has(x.url)) { seen.add(x.url); out.push(x); }
  });
  return out;
}

function resultHTML(r) {
  const h = host(r.url);
  return `<li class="r">
    <div class="site"><span class="fav">${esc((h[0] || "?").toUpperCase())}</span><span class="u">${esc(r.url.replace(/^https?:\/\//, ""))}</span></div>
    <h3><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a></h3>
    <p>${esc(r.snippet)}</p>
    ${r.tags?.length ? `<div class="meta">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
  </li>`;
}

function renderSummary(items, q) {
  const wiki = items.filter(i => i.full).slice(0, 2).map(i => i.full);
  const others = items.filter(i => !i.full).slice(0, 8).map(i => i.title + ". " + i.snippet);
  const bullets = summarise([...wiki, ...others], 4);
  const el = $("#summary");
  $("#research-question").value = q;
  $("#ai-status").textContent = "The first run downloads a small model; your browser caches it for next time.";
  $("#ai-answer").hidden = true;
  $("#ai-answer").textContent = "";
  $("#ai-sources").hidden = true;
  $("#ai-sources").innerHTML = "";
  $("#ask-button").disabled = false;
  if (!bullets.length) {
    $("#quick-summary").textContent = "There is not enough source text for a quick summary. You can still ask the local model about the results.";
    el.hidden = false;
    return;
  }
  const srcLinks = [...new Set(bullets.map(b => b.ti))].map(ti => {
    const it = ti < wiki.length ? items.filter(i => i.full)[ti] : items.filter(i => !i.full)[ti - wiki.length];
    return it ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(host(it.url))}</a>` : "";
  }).filter(Boolean);
  $("#quick-summary").innerHTML = `<ul>${bullets.map(b => `<li>${esc(b.s)}</li>`).join("")}</ul>
    <div class="src">Sentence-ranked from search results · Sources: ${srcLinks.join(", ")}</div>`;
  el.hidden = false;
}

function getResearchWorker() {
  if (researchWorker) return researchWorker;
  researchWorker = new Worker("./ai-worker.js", { type: "module" });
  researchWorker.addEventListener("message", event => {
    const data = event.data;
    if (data.id !== researchRequestId) return;
    if (data.type === "progress") {
      $("#ai-status").textContent = data.message;
      return;
    }
    $("#ask-button").disabled = false;
    if (data.type === "answer") {
      $("#ai-answer").textContent = data.text;
      $("#ai-answer").hidden = false;
      const sources = state.items.slice(0, 5);
      $("#ai-sources").innerHTML = `<h3>Sources</h3><ol>${sources.map((item, index) =>
        `<li><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">[${index + 1}] ${esc(item.title)}</a></li>`
      ).join("")}</ol>`;
      $("#ai-sources").hidden = false;
      $("#ai-status").textContent = "Generated in your browser from the search excerpts below. Check sources for details.";
    } else if (data.type === "error") {
      $("#ai-status").textContent = `The local model could not run: ${data.message}. Check your connection and try again.`;
    }
  });
  researchWorker.addEventListener("error", event => {
    $("#ask-button").disabled = false;
    $("#ai-status").textContent = "The local model worker failed to start. Reload the page and try again.";
    console.error(event.message);
    researchWorker.terminate();
    researchWorker = null;
  });
  return researchWorker;
}

function research(question) {
  const excerpts = state.items.slice(0, 5).map(item => ({
    title: item.title,
    url: item.url,
    snippet: (item.full || item.snippet || "").slice(0, 500)
  }));
  if (!excerpts.length) return;
  const id = ++researchRequestId;
  $("#ask-button").disabled = true;
  $("#ai-answer").hidden = true;
  $("#ai-sources").hidden = true;
  $("#ai-status").textContent = "Starting the local model. The first run may take a few minutes while files download.";
  try {
    getResearchWorker().postMessage({ type: "research", id, question, excerpts });
  } catch (error) {
    $("#ask-button").disabled = false;
    $("#ai-status").textContent = `The local model could not start: ${error.message}`;
  }
}

function renderSide(items, q) {
  const encoded = encodeURIComponent(q);
  const webLinks = [
    ["DuckDuckGo", `https://duckduckgo.com/?q=${encoded}`],
    ["Google", `https://www.google.com/search?q=${encoded}`],
    ["Bing", `https://www.bing.com/search?q=${encoded}`],
    ["Brave", `https://search.brave.com/search?q=${encoded}`]
  ];
  const w = items.find(i => i.source === "Wikipedia");
  $("#side").innerHTML = `<section class="web-search">
    <span class="eyebrow">WIDER WEB</span>
    <h2>Search more websites</h2>
    <div class="web-links">${webLinks.map(([name, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}<span aria-hidden="true">↗</span></a>`).join("")}</div>
  </section>`;
  if (w) $("#side").insertAdjacentHTML("beforeend", `<div class="card">
    ${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : ""}
    <h2>${esc(w.title)}</h2><div class="sub">from Wikipedia</div>
    <p>${esc((w.full || "").split(/(?<=[.!?])\s/).slice(0, 3).join(" "))}</p>
    <a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Read on Wikipedia</a>
  </div>`);
}

/* ---------- wiring ---------- */
$("#form").addEventListener("submit", e => { e.preventDefault(); run($("#q").value, "all"); });
$("#ask-form").addEventListener("submit", e => {
  e.preventDefault();
  const question = $("#research-question").value.trim();
  if (question) research(question);
});
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b && state.q) run(state.q, b.dataset.tab); });
document.querySelector(".chips").addEventListener("click", e => { const b = e.target.closest("button"); if (b) run(b.dataset.s, "all"); });

function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem("seekr-theme", t); } catch {} }
$("#theme").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
(() => {
  let t = null; try { t = localStorage.getItem("seekr-theme"); } catch {}
  applyTheme(t || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const p = new URLSearchParams(location.search);
  if (p.get("q")) run(p.get("q"), tabSources[p.get("tab")] ? p.get("tab") : "all");
})();

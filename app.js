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
  all: ["wikipedia", "marginalia", "hn"],
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
let state = { q: "", tab: "all", cache: {} };

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
  $("#summary").hidden = true;
  $("#side").innerHTML = "";
  $("#status").textContent = "Searching…";

  const names = tabSources[tab];
  const settled = await Promise.allSettled(names.map(n => sources[n](q)));
  if (state.q !== q || state.tab !== tab) return;

  const failed = [], reasons = [];
  const lists = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    failed.push(names[i]); reasons.push(`${names[i]}: ${r.reason?.name === "AbortError" ? "timed out" : (r.reason?.message || "blocked")}`);
    return [];
  });
  let items = interleave(lists);

  if (!items.length) {
    $("#status").innerHTML = failed.length
      ? `Couldn't reach any source (${esc(reasons.join("; "))}). Open the page from http://localhost or GitHub Pages instead of a file, and check your connection or ad blocker.`
      : `No results for <b>${esc(q)}</b>. Try fewer or different words.`;
    return;
  }
  $("#status").textContent = `${items.length} results` + (failed.length ? ` (unavailable: ${failed.join(", ")})` : "");
  $("#results").innerHTML = items.map(resultHTML).join("");

  if (tab === "all") {
    renderSummary(items, q);
    renderSide(items);
  }
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
  if (!bullets.length) return;
  const srcLinks = [...new Set(bullets.map(b => b.ti))].map(ti => {
    const it = ti < wiki.length ? items.filter(i => i.full)[ti] : items.filter(i => !i.full)[ti - wiki.length];
    return it ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(host(it.url))}</a>` : "";
  }).filter(Boolean);
  const el = $("#summary");
  el.innerHTML = `<h2>✨ Summary <small>for “${esc(q)}”</small></h2>
    <ul>${bullets.map(b => `<li>${esc(b.s)}</li>`).join("")}</ul>
    <div class="src">Built on your device from top results · Sources: ${srcLinks.join(", ")}</div>`;
  el.hidden = false;
}

function renderSide(items) {
  const w = items.find(i => i.source === "Wikipedia");
  if (!w) return;
  $("#side").innerHTML = `<div class="card">
    ${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : ""}
    <h2>${esc(w.title)}</h2><div class="sub">from Wikipedia</div>
    <p>${esc((w.full || "").split(/(?<=[.!?])\s/).slice(0, 3).join(" "))}</p>
    <a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Read on Wikipedia</a>
  </div>`;
}

/* ---------- wiring ---------- */
$("#form").addEventListener("submit", e => { e.preventDefault(); run($("#q").value, "all"); });
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

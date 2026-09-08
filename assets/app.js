/* U can AI 知识库 — 静态站前端（无后端、无外网依赖） */
const $ = (s) => document.querySelector(s);
const state = {
  meta: null, docs: [], byPath: new Map(), byId: new Map(),
  group: null, category: null, query: "", full: false,
  current: null, shards: [], shardLoaded: 0,
};

/* ---------- 工具 ---------- */
const fmt = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + " 万" : n.toLocaleString("zh-CN"));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = (s) => "h-" + String(s || "").toLowerCase().replace(/[^\w一-龥]+/g, "-").replace(/^-|-$/g, "");

function toast(msg, ms = 1800) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
}

/* marked 缺失时的降级渲染（正常不会走到，marked 已内置） */
function miniMarkdown(src) {
  let text = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const blocks = [];
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  text = esc(text)
    .replace(/^######\s+(.+)$/gm, "<h6>$1</h6>").replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
    .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>").replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>").replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^---+$/gm, "<hr>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" data-md="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^\s*[-*+]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/^\s*\d+\.\s+(.+)$/gm, "<li>$1</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
  text = text.split(/\n{2,}/).map((p) => (/^<(h\d|ul|ol|blockquote|hr|pre|img)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("\n");
  return text.replace(/\u0000B(\d+)\u0000/g, (_, i) => blocks[+i]);
}

function renderMarkdown(md) {
  const src = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  let html;
  try {
    if (window.marked) { window.marked.setOptions({ gfm: true }); html = window.marked.parse(src); }
    else html = miniMarkdown(src);
  } catch (e) { html = miniMarkdown(src); }
  return html.replace(/href="([^"]+\.md)"/g, (m, href) => `href="#" data-md="${href}"`);
}

/* ---------- 路由 ---------- */
function setHash(h) { if (location.hash !== h) location.hash = h; }
function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  const m = h.match(/^\/(d|g|c)\/(.*)$/);
  if (!m) return { view: "overview" };
  const [, kind, rest] = m;
  if (kind === "d") return { view: "doc", id: parseInt(rest, 10) };
  if (kind === "g") return { view: "group", group: rest };
  const i = rest.indexOf("/");
  return { view: "group", group: rest.slice(0, i), category: rest.slice(i + 1) };
}
function applyRoute() {
  const r = parseHash();
  closeReaderLayout();
  if (r.view === "doc" && state.byId.has(r.id)) { selectGroupForDoc(state.byId.get(r.id)); openDoc(r.id, false); return; }
  if (r.view === "group") { state.group = r.group; state.category = r.category || null; }
  else { state.group = null; state.category = null; }
  renderNav(); applyFilter();
}
function selectGroupForDoc(doc) { state.group = doc.groupKey; state.category = doc.category; renderNav(); applyFilter(); }

/* ---------- 侧边栏 ---------- */
function renderNav() {
  const m = state.meta;
  let html = `<div class="navgroup ${!state.group ? "active" : ""}">
      <button data-nav="__all__"><span class="caret">▸</span>总览 Dashboard<span class="cnt">${m.totalDocs}</span></button>
    </div>`;
  for (const g of m.groups) {
    const open = state.group === g.key;
    html += `<div class="navgroup ${open ? "open active" : ""}">
      <button data-nav="${esc(g.key)}"><span class="caret">▸</span>${esc(g.label)}<span class="cnt">${g.count}</span></button>
      <div class="cats">
        <button data-nav="${esc(g.key)}" data-cat="__all__" class="${open && !state.category ? "active" : ""}">全部<span class="cnt">${g.count}</span></button>
        ${g.categories.map(([c, n]) => `<button data-nav="${esc(g.key)}" data-cat="${esc(c)}" class="${open && state.category === c ? "active" : ""}">${esc(c)}<span class="cnt">${n}</span></button>`).join("")}
      </div>
    </div>`;
  }
  $("#nav").innerHTML = html;
  $("#nav").querySelectorAll("button[data-nav]").forEach((btn) => {
    btn.onclick = () => {
      const g = btn.dataset.nav, c = btn.dataset.cat;
      if (g === "__all__") setHash("#/");
      else if (c) setHash(c === "__all__" ? `#/g/${encodeURIComponent(g)}` : `#/c/${encodeURIComponent(g)}/${encodeURIComponent(c)}`);
      else setHash(state.group === g ? "#/" : `#/g/${encodeURIComponent(g)}`);
    };
  });
}

/* ---------- 列表 ---------- */
function currentDocs() {
  let docs = state.docs;
  if (state.group) {
    docs = docs.filter((d) => d.groupKey === state.group);
    if (state.category) docs = docs.filter((d) => d.category === state.category);
  }
  const sort = $("#sort").value;
  if (sort === "words") docs = [...docs].sort((a, b) => b.words - a.words);
  else if (sort === "mtime") docs = [...docs].sort((a, b) => b.mtimeTs - a.mtimeTs);
  else if (sort === "title") docs = [...docs].sort((a, b) => a.title.localeCompare(b.title, "zh"));
  return docs;
}

function applyFilter() {
  const docs = currentDocs();
  const g = state.meta.groups.find((x) => x.key === state.group);
  $("#listTitle").textContent = state.group ? (g ? g.label : state.group) + (state.category ? " / " + state.category : "") : "全部文档";
  $("#listCount").textContent = `${docs.length} 篇 · ${fmt(docs.reduce((s, d) => s + d.words, 0))} 字`;
  renderList(docs);
  if (!state.current) showPanel();
}

function renderList(docs) {
  const list = $("#list");
  if (!docs.length) { list.innerHTML = `<div class="spin">没有匹配的文档</div>`; return; }
  const show = docs.slice(0, 400);
  list.innerHTML = show.map((d) => `<a class="card ${state.current === d.id ? "active" : ""}" href="#/d/${d.id}" data-id="${d.id}">
      <h3>${esc(d.title)}</h3>
      <p>${esc(d.summary)}</p>
      ${d.snippet ? `<div class="snippet">${esc(d.snippet)}</div>` : ""}
      <div class="tags"><span>${esc(d.category)}</span><span>${fmt(d.words)} 字</span><span>${esc(d.mtime)}</span>
        <span class="go">阅读 →</span></div>
    </a>`).join("") + (docs.length > show.length ? `<div class="spin">仅显示前 ${show.length} 条，请细化筛选或搜索</div>` : "");
  list.querySelectorAll(".card").forEach((c) => {
    c.onclick = (e) => { e.preventDefault(); setHash(`#/d/${c.dataset.id}`); };
  });
}

/* ---------- 阅读 ---------- */
async function openDoc(id, scrollTop = true) {
  const doc = state.byId.get(id);
  if (!doc) { toast("未找到该文档"); return; }
  state.current = id;
  openReaderLayout();
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("active", +c.dataset.id === id));
  $("#docTitle").textContent = doc.title;
  $("#docMeta").innerHTML = [`<code>${esc(doc.path)}</code>`, `${fmt(doc.words)} 字`, `更新 ${esc(doc.mtime)}`,
    doc.author ? `作者 ${esc(doc.author)}` : ""].filter(Boolean).join(" · ");
  $("#content").innerHTML = `<div class="spin">加载中…</div>`;
  $("#toc").innerHTML = ""; $("#toc").classList.remove("show");

  if (scrollTop) $("#reader").scrollTop = 0;

  try {
    const res = await fetch(`data/docs/${id}.json`, { cache: "force-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (state.current !== id) return;
    $("#content").innerHTML = renderMarkdown(data.md);
    buildToc(); wireLinks(doc);
  } catch (e) {
    $("#content").innerHTML = `<div class="spin">加载失败：${esc(String(e))}<br><br>
      <button class="ghost" onclick="location.reload()">重试</button></div>`;
  }
}

function buildToc() {
  const heads = [...$("#content").querySelectorAll("h2, h3")];
  const toc = $("#toc");
  if (heads.length < 2) { toc.innerHTML = ""; return; }
  heads.forEach((h) => { if (!h.id) h.id = slug(h.textContent); });
  toc.innerHTML = heads.map((h) => `<a class="${h.tagName.toLowerCase()}" href="#${h.id}">${esc(h.textContent)}</a>`).join("");
  toc.classList.toggle("show", $("#tocBtn").classList.contains("on"));
  toc.querySelectorAll("a").forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth" }); };
  });
}

function wireLinks(doc) {
  const base = doc.path.includes("/") ? doc.path.split("/").slice(0, -1).join("/") : "";
  $("#content").querySelectorAll("a[data-md]").forEach((a) => {
    const raw = decodeURIComponent(a.dataset.md).split("#")[0];
    let target = raw.startsWith("/") ? raw.slice(1) : base ? base + "/" + raw : raw;
    a.onclick = (e) => {
      e.preventDefault();
      const hit = state.byPath.get(target) || [...state.byPath.keys()].find((p) => p.endsWith(target));
      if (hit) setHash(`#/d/${state.byPath.get(hit).id}`);
      else toast("该链接指向的文件不在知识库内：" + target);
    };
  });
}

/* 窄屏时阅读区为覆盖层 */
function openReaderLayout() { $("#reader").classList.add("open"); }
function closeReaderLayout() { $("#reader").classList.remove("open"); }

/* ---------- 面板（总览 / 分类说明） ---------- */
function showPanel() {
  if (state.group) renderCategoryPanel(); else renderOverview();
}

function renderOverview() {
  const m = state.meta;
  const max = Math.max(...m.groups.map((g) => g.count));
  const recent = [...state.docs].sort((a, b) => b.mtimeTs - a.mtimeTs).slice(0, 8);
  const top = [...state.docs].sort((a, b) => b.words - a.words).slice(0, 8);
  $("#docTitle").textContent = "总览";
  $("#docMeta").innerHTML = `${m.totalDocs} 篇 · ${fmt(m.totalWords)} 字 · 内容更新于 ${esc(m.generatedAt)}`;
  $("#toc").innerHTML = "";
  $("#content").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="v">${m.totalDocs}</div><div class="k">文档总数</div></div>
      <div class="stat"><div class="v">${fmt(m.totalWords)}</div><div class="k">总字数</div></div>
      <div class="stat"><div class="v">${m.groups.length}</div><div class="k">分区数</div></div>
      <div class="stat"><div class="v">${(m.totalSize / 1048576).toFixed(1)} MB</div><div class="k">体积</div></div>
    </div>
    <h3 class="sec">分区入口</h3>
    <div class="cards">${m.groups.map((g) => `<div class="gcard" data-goto="${esc(g.key)}">
        <h4>${esc(g.label)}</h4><p>${esc(g.desc)}</p><div class="gmeta">${g.count} 篇 · ${fmt(g.words)} 字</div></div>`).join("")}</div>
    <h3 class="sec">各分区文档数</h3>
    <div class="bars">${m.groups.map((g) => `<div class="bar" data-goto="${esc(g.key)}"><span>${esc(g.label)}</span>
        <div class="track"><div class="fill" style="width:${(g.count / max) * 100}%"></div></div>
        <span class="num">${g.count} 篇</span></div>`).join("")}</div>
    <h3 class="sec">最长篇幅</h3>
    <div class="bars">${top.map((d) => `<div class="bar" data-doc="${d.id}"><span title="${esc(d.path)}">${esc(d.title.slice(0, 14))}</span>
        <div class="track"><div class="fill" style="width:${(d.words / top[0].words) * 100}%"></div></div>
        <span class="num">${fmt(d.words)} 字</span></div>`).join("")}</div>
    <h3 class="sec">最近更新</h3>
    <div class="bars">${recent.map((d) => `<div class="bar" data-doc="${d.id}"><span>${esc(d.mtime)}</span>
        <div class="track" style="background:none"><span style="font-size:12.5px">${esc(d.title.slice(0, 26))}</span></div>
        <span class="num">${esc(d.category)}</span></div>`).join("")}</div>`;
  bindPanelLinks();
}

function renderCategoryPanel() {
  const g = state.meta.groups.find((x) => x.key === state.group);
  const docs = currentDocs();
  const top = [...docs].sort((a, b) => b.words - a.words).slice(0, 12);
  $("#docTitle").textContent = (g ? g.label : state.group) + (state.category ? " / " + state.category : "");
  $("#docMeta").innerHTML = `${docs.length} 篇 · ${fmt(docs.reduce((s, d) => s + d.words, 0))} 字 · 点标题开始阅读`;
  $("#toc").innerHTML = "";
  $("#content").innerHTML = `
    <p class="hint">${g && g.desc ? esc(g.desc) : ""} 已筛选出 <b>${docs.length}</b> 篇，从右侧点任意标题即可阅读全文。</p>
    <h3 class="sec">本类篇幅最长</h3>
    <div class="bars">${top.map((d) => `<div class="bar" data-doc="${d.id}"><span title="${esc(d.title)}">${esc(d.title.slice(0, 14))}</span>
        <div class="track"><div class="fill" style="width:${(d.words / (top[0].words || 1)) * 100}%"></div></div>
        <span class="num">${fmt(d.words)} 字</span></div>`).join("")}</div>`;
  bindPanelLinks();
}

function bindPanelLinks() {
  $("#content").querySelectorAll("[data-doc]").forEach((el) => {
    el.style.cursor = "pointer";
    el.onclick = () => setHash(`#/d/${el.dataset.doc}`);
  });
  $("#content").querySelectorAll("[data-goto]").forEach((el) => {
    el.style.cursor = "pointer";
    el.onclick = () => setHash(`#/g/${encodeURIComponent(el.dataset.goto)}`);
  });
}

/* ---------- 搜索 ---------- */
let searchTimer = null;
function doSearch() {
  const q = state.query.trim();
  if (!q) { applyRoute(); return; }
  const low = q.toLowerCase();
  const res = state.docs.filter((d) => d.title.toLowerCase().includes(low) || d.path.toLowerCase().includes(low) ||
    d.summary.toLowerCase().includes(low) || d.category.toLowerCase().includes(low));
  res.sort((a, b) => (b.title.toLowerCase().includes(low) ? 1 : 0) - (a.title.toLowerCase().includes(low) ? 1 : 0));
  $("#listTitle").textContent = `搜索「${q}」`;
  $("#listCount").textContent = `${res.length} 条结果`;
  renderList(res);
}

async function searchFull() {
  const q = state.query.trim();
  if (!q) return;
  const shards = state.meta.shards;
  const hits = [];
  $("#listTitle").textContent = `全文搜索「${q}」`;
  for (let i = 0; i < shards.length; i++) {
    $("#listCount").textContent = `检索中 ${i + 1}/${shards.length}…`;
    try {
      const res = await fetch(`data/shards/${shards[i]}`, { cache: "force-cache" });
      const chunk = await res.json();
      for (const it of chunk) {
        const pos = it.t.toLowerCase().indexOf(q.toLowerCase());
        if (pos < 0) continue;
        const d = state.byId.get(it.i);
        if (!d) continue;
        hits.push({ ...d, snippet: (pos > 40 ? "…" : "") + it.t.slice(Math.max(0, pos - 40), pos + q.length + 90) + "…" });
      }
      if (hits.length) { $("#listCount").textContent = `已找到 ${hits.length} 条`; renderList(hits.slice(0, 300)); }
    } catch (e) { /* 跳过失败分片 */ }
  }
  $("#listCount").textContent = `${hits.length} 条结果`;
  renderList(hits.slice(0, 300));
  if (!hits.length) toast("全文搜索没有匹配");
}

/* ---------- 初始化 ---------- */
async function boot() {
  try {
    const res = await fetch("data/meta.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.meta = await res.json();
  } catch (e) {
    $("#list").innerHTML = `<div class="spin">索引加载失败：${esc(String(e))}</div>`;
    return;
  }
  state.docs = state.meta.docs;
  state.docs.forEach((d) => { state.byId.set(d.id, d); state.byPath.set(d.path, d); });
  $("#genAt").textContent = `${state.meta.totalDocs} 篇 · ${fmt(state.meta.totalWords)} 字 · 更新于 ${state.meta.generatedAt}`;
  $("#genAt").title = "内容同步时间";

  window.addEventListener("hashchange", applyRoute);
  $("#sort").onchange = () => (state.query.trim() ? doSearch() : applyFilter());
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => (state.full ? searchFull() : doSearch()), state.full ? 500 : 180);
  });
  $("#search").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !state.full) { state.full = true; $("#fullBtn").classList.add("on"); searchFull(); }
  });
  $("#fullBtn").onclick = () => {
    state.full = !state.full; $("#fullBtn").classList.toggle("on", state.full);
    if (state.query.trim()) state.full ? searchFull() : doSearch();
    else toast(state.full ? "已开启全文搜索（回车/输入即检索）" : "已关闭全文搜索");
  };
  $("#clearBtn").onclick = () => { $("#search").value = ""; state.query = ""; setHash("#/"); };
  $("#tocBtn").onclick = () => { const on = $("#tocBtn").classList.toggle("on"); $("#toc").classList.toggle("show", on && !!$("#toc").innerHTML); };
  $("#backBtn").onclick = () => { state.current = null; closeReaderLayout(); setHash(state.group ? `#/g/${encodeURIComponent(state.group)}` : "#/"); };
  $("#copyBtn").onclick = async () => {
    const d = state.current != null ? state.byId.get(state.current) : null;
    if (!d) return toast("请先打开一篇文档");
    try { await navigator.clipboard.writeText(d.path); toast("已复制路径"); } catch { toast(d.path); }
  };
  $("#brandBtn").onclick = () => setHash("#/");
  $("#menuBtn").onclick = () => $("#sidebar").classList.toggle("show");
  document.addEventListener("click", (e) => {
    if (window.innerWidth < 980 && !e.target.closest("#sidebar") && !e.target.closest("#menuBtn")) $("#sidebar").classList.remove("show");
  });

  applyRoute();
}

boot();

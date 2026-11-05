import {
  collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  app, db, configured, ownerConfigured, OWNER_UID, LSTAT, $, esc, fmt, daysLeft, dateBox, duePill,
  byDeadline, randomToken, copyText,
} from "./common.js";

const LEVELS = [["req", "Required"], ["rec", "Recommended"], ["opt", "Optional"]];
const DEFAULT_REQS = [
  ["Statement of purpose", "req"], ["CV", "req"], ["Transcripts", "req"], ["Application fee or waiver", "req"],
  ["Writing sample", "rec"], ["GRE scores", "opt"], ["Personal history / diversity statement", "opt"],
];
const TABS = ["overview", "programs", "recommenders", "links", "profile"];

let programs = [], recs = [], links = [], shares = {}, profile = {};
let openSet = new Set(), drafts = new Set(), armed = null, country = "All";
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- Sign-in gate ---------- */
function gate(title, html, actions = "") {
  $("gate").hidden = false; $("appRoot").hidden = true;
  $("gateTitle").textContent = title; $("gateText").innerHTML = html; $("gateActions").innerHTML = actions;
}

if (!configured) {
  gate("Almost ready", "Paste your Firebase settings into <code>js/firebase-config.js</code>. The README walks you through it in about ten minutes.");
} else {
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  document.addEventListener("click", (e) => {
    if (e.target.id === "signIn") signInWithPopup(auth, provider).catch((err) => showGateError(err));
    if (e.target.id === "signOut" || e.target.id === "signOut2") signOut(auth);
  });
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      gate("Sign in to your tracker", "Only you can open this dashboard. Recommenders use their own private links.",
        '<button type="button" id="signIn">Sign in with Google</button>');
      return;
    }
    if (!ownerConfigured || user.uid !== OWNER_UID) {
      gate(ownerConfigured ? "This tracker belongs to someone else" : "One last step",
        `Your user ID is<br><code>${esc(user.uid)}</code><br><br>Paste it into <code>js/firebase-config.js</code> (OWNER_UID) and into <code>firestore.rules</code>, publish the rules, then reload this page.`,
        '<button type="button" class="quiet" id="signOut2">Sign out</button>');
      return;
    }
    $("gate").hidden = true; $("appRoot").hidden = false;
    start();
  });
}
function showGateError(err) {
  $("gateText").textContent = "Sign-in did not finish (" + (err.code || "error") + "). Check that Google sign-in is enabled and this site is an authorized domain in Firebase.";
}

/* ---------- Live data ---------- */
let started = false;
function start() {
  if (started) return; started = true;
  route(); renderAll();
  const fail = () => showBanner("Could not reach your data. Check your connection, then reload.");
  onSnapshot(collection(db, "programs"), (s) => { programs = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderAll(); }, fail);
  onSnapshot(collection(db, "recommenders"), (s) => { recs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0)); renderAll(); }, fail);
  onSnapshot(collection(db, "links"), (s) => { links = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0)); renderAll(); }, fail);
  onSnapshot(collection(db, "shares"), (s) => { shares = {}; s.docs.forEach((d) => (shares[d.id] = d.data())); renderAll(); }, fail);
  onSnapshot(doc(db, "settings", "profile"), (s) => { profile = s.exists() ? s.data() : {}; renderProfile(); }, fail);
}

/* ---------- Helpers ---------- */
function showBanner(t) { const b = $("banner"); b.textContent = t || ""; b.hidden = !t; }
const P = (id) => programs.find((p) => p.id === id);
const R = (id) => recs.find((r) => r.id === id);
const letterOf = (p, r) => shares[r.token]?.letters?.[p.id] || "none";
const assigned = (p) => recs.filter((r) => letterOf(p, r) !== "none");
const summary = (p) => ({ school: p.school || "", name: p.name || "", country: p.country || "", deadline: p.deadline || "" });
const shareUrl = (r) => new URL(`recommender.html?k=${r.token}`, location.href).href;
const sorted = () => [...programs].sort((a, b) => (!!a.submitted - !!b.submitted) || byDeadline(a, b));
const visible = () => sorted().filter((p) => country === "All" || (p.country || "No country") === country);
function progress(p) {
  const reqs = (p.reqs || []).filter((x) => x.level !== "opt");
  const a = assigned(p);
  const total = reqs.length + a.length;
  const done = reqs.filter((x) => x.done).length + a.filter((r) => letterOf(p, r) === "submitted").length;
  return { total, done, pct: p.submitted ? 100 : total ? Math.round((done / total) * 100) : 0 };
}
function meter(el, a, b) { el.querySelector("i").style.width = (b ? (a / b) * 100 : 0) + "%"; el.classList.toggle("done", b > 0 && a === b); }
async function safe(fn) {
  try { await fn(); } catch (e) { console.error(e); showBanner("That change could not be saved. Check your connection and try again."); }
}

/* ---------- Writes that keep recommender pages in sync ---------- */
function updateProgram(pid, data) {
  return safe(async () => {
    await updateDoc(doc(db, "programs", pid), data);
    if (["school", "name", "country", "deadline"].some((k) => k in data)) {
      const p = { ...P(pid), ...data };
      const b = writeBatch(db);
      assigned(p).forEach((r) => b.update(doc(db, "shares", r.token), { [`programs.${pid}`]: summary(p) }));
      await b.commit();
    }
  });
}
function assign(p, r, on) {
  return safe(() => updateDoc(doc(db, "shares", r.token), on
    ? { [`programs.${p.id}`]: summary(p), [`letters.${p.id}`]: "request" }
    : { [`programs.${p.id}`]: deleteField(), [`letters.${p.id}`]: deleteField() }));
}
const setLetter = (p, r, st) => safe(() => updateDoc(doc(db, "shares", r.token), { [`letters.${p.id}`]: st }));
const setReqs = (pid, fn) => { const p = P(pid); if (p) updateProgram(pid, { reqs: fn((p.reqs || []).map((q) => ({ ...q }))) }); };
function shareBase() {
  return { ownerName: profile.name || "", ownerEmail: profile.email || "",
    materials: { cv: profile.cv || "", sop: profile.sop || "", ws: profile.ws || "", other: profile.other || "" } };
}

/* ---------- Rendering ---------- */
function renderHero() {
  $("today").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const next = sorted().find((p) => !p.submitted && daysLeft(p.deadline) !== null && daysLeft(p.deadline) >= 0);
  if (next) {
    const n = daysLeft(next.deadline);
    $("cdBig").innerHTML = `${n}<small>${n === 1 ? "day" : "days"}</small>`;
    $("cdWho").textContent = next.school + (next.country ? " · " + next.country : "");
    $("cdWhen").textContent = fmt(next.deadline, { weekday: "long", month: "long", day: "numeric" });
  } else {
    $("cdBig").textContent = "–";
    $("cdWho").textContent = programs.length ? "Nothing upcoming" : "Add a program to start the countdown";
    $("cdWhen").innerHTML = "&nbsp;";
  }
  const sub = programs.filter((p) => p.submitted).length;
  $("stSub").innerHTML = `${sub}<span>/${programs.length}</span>`; meter($("mSub"), sub, programs.length);
  let lt = 0, ld = 0, rt = 0, rd = 0;
  for (const p of programs) {
    for (const r of assigned(p)) { lt++; if (letterOf(p, r) === "submitted") ld++; }
    for (const q of p.reqs || []) if (q.level === "req") { rt++; if (q.done) rd++; }
  }
  $("stLet").innerHTML = `${ld}<span>/${lt}</span>`; meter($("mLet"), ld, lt);
  $("stReq").innerHTML = `${rd}<span>/${rt}</span>`; meter($("mReq"), rd, rt);
  $("nProg").textContent = programs.length; $("nRec").textContent = recs.length; $("nLink").textContent = links.length;
}

function renderOverview() {
  $("timeline").innerHTML = programs.length ? sorted().map((p) => {
    const g = progress(p);
    return `<a href="#programs" data-goto="${p.id}" class="${p.submitted ? "isdone" : ""}">${dateBox(p.deadline)}
      <div class="mid"><b>${esc(p.school)}</b><span class="small muted">${esc(p.country || "No country set")}</span><div class="meter${g.pct === 100 ? " done" : ""}"><i style="width:${g.pct}%"></i></div></div>
      <div style="display:grid;gap:4px;justify-items:end">${duePill(p.deadline, p.submitted)}<span class="pct">${g.pct}%</span></div></a>`;
  }).join("") : '<div class="empty">No programs yet. Add them on the Programs tab, starting with the earliest deadline.</div>';

  const items = [];
  for (const p of sorted()) {
    if (p.submitted) continue;
    const n = daysLeft(p.deadline); if (n === null || n > 30) continue;
    const when = n < 0 ? "deadline passed" : n + "d";
    const missing = (p.reqs || []).filter((q) => q.level === "req" && !q.done).map((q) => q.label);
    if (missing.length) items.push(["req", `<b>${esc(p.school)}</b> <span class="muted">· ${when}</span><br><span class="small">Missing: ${esc(missing.join(", "))}</span>`]);
    const lt = assigned(p).filter((r) => letterOf(p, r) !== "submitted");
    if (lt.length) items.push(["", `<b>${esc(p.school)}</b> <span class="muted">· ${when}</span><br><span class="small">Letters pending: ${esc(lt.map((r) => r.name).join(", "))}</span>`]);
  }
  $("todo").innerHTML = items.length ? items.map(([c, h]) => `<li><span class="dot ${c}"></span><span>${h}</span></li>`).join("")
    : '<li><span class="dot ok"></span><span class="muted">Nothing urgent in the next 30 days.</span></li>';

  const groups = {};
  programs.forEach((p) => { const c = p.country || "No country"; (groups[c] ??= []).push(p); });
  const rows = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  $("byCountry").innerHTML = rows.length ? rows.map(([c, ps]) => {
    const s = ps.filter((p) => p.submitted).length;
    return `<div class="crow"><span><b>${esc(c)}</b> <span class="small muted">· ${ps.length} program${ps.length > 1 ? "s" : ""}</span></span><span class="pill ${s === ps.length ? "done" : ""}">${s}/${ps.length} submitted</span></div>`;
  }).join("") : '<div class="empty" style="padding:14px 0">Countries appear as you add programs.</div>';
}

function renderFilters() {
  const counts = {};
  programs.forEach((p) => { const c = p.country || "No country"; counts[c] = (counts[c] || 0) + 1; });
  const list = Object.keys(counts).sort();
  if (country !== "All" && !counts[country]) country = "All";
  $("filters").hidden = list.length < 2;
  $("filters").innerHTML = [["All", programs.length], ...list.map((c) => [c, counts[c]])]
    .map(([c, n]) => `<button type="button" data-country="${esc(c)}" aria-pressed="${c === country}">${esc(c)}<span class="c">${n}</span></button>`).join("");
}

function renderPrograms() {
  renderFilters();
  const el = $("progList");
  if (!programs.length) { el.innerHTML = '<div class="card empty">Add your first program above. Each one starts with a standard checklist you can adjust to the school.</div>'; return; }
  el.innerHTML = visible().map((p) => {
    const g = progress(p);
    const order = (l) => LEVELS.findIndex((x) => x[0] === l);
    const reqs = (p.reqs || []).slice().sort((a, b) => order(a.level) - order(b.level));
    const reqHtml = reqs.length ? reqs.map((q) => `<div class="rq ${q.level}${q.done ? " isdone" : ""}">
        <input type="checkbox" id="q-${p.id}-${q.id}" data-act="reqdone" data-pid="${p.id}" data-qid="${q.id}"${q.done ? " checked" : ""}>
        <label class="lbl" for="q-${p.id}-${q.id}">${esc(q.label)}</label>
        <select id="ql-${p.id}-${q.id}" class="${q.level}" data-act="reqlevel" data-pid="${p.id}" data-qid="${q.id}" aria-label="Importance">${LEVELS.map(([v, l]) => `<option value="${v}"${q.level === v ? " selected" : ""}>${l}</option>`).join("")}</select>
        <button type="button" class="danger" data-act="reqdel" data-pid="${p.id}" data-qid="${q.id}" aria-label="Remove ${esc(q.label)}">✕</button></div>`).join("")
      : '<div class="empty small">No items yet.</div>';
    const asHtml = recs.length ? recs.map((r) => {
      const s = letterOf(p, r), on = s !== "none";
      return `<div class="as${on ? "" : " off"} st-${s}">
        <input type="checkbox" id="a-${p.id}-${r.id}" data-act="assign" data-pid="${p.id}" data-rid="${r.id}"${on ? " checked" : ""} aria-label="${esc(r.name)} writes for this school">
        <label for="a-${p.id}-${r.id}"><b>${esc(r.name)}</b> <span class="small muted">${esc(r.affiliation)}</span></label>
        ${on ? `<select id="ls-${p.id}-${r.id}" class="st-${s}" data-act="lstat" data-pid="${p.id}" data-rid="${r.id}">${LSTAT.map(([v, l]) => `<option value="${v}"${s === v ? " selected" : ""}>${l}</option>`).join("")}</select>` : '<span class="small muted">Not writing for this school</span>'}
      </div>`;
    }).join("") : '<div class="small muted">Add recommenders on the Recommenders tab, then assign them here.</div>';
    return `<details class="prog${p.submitted ? " isdone" : ""}" data-id="${p.id}" id="prog-${p.id}"${openSet.has(p.id) ? " open" : ""}>
      <summary>${dateBox(p.deadline)}
        <div class="ptitle"><b>${esc(p.school)}</b><div class="sub">${p.country ? `<span class="pill flag">${esc(p.country)}</span>` : ""}<span>${esc(p.name || "PhD program")}</span>${duePill(p.deadline, p.submitted)}</div></div>
        <div class="pright"><span class="pct">${g.done}/${g.total} · ${g.pct}%</span><div class="meter${g.pct === 100 ? " done" : ""}" style="width:100%"><i style="width:${g.pct}%"></i></div></div>
      </summary>
      <div class="pbody">
        <div class="fields">
          <label class="f">University<input type="text" id="fs-${p.id}" data-act="field" data-k="school" data-pid="${p.id}" value="${esc(p.school)}"></label>
          <label class="f">Country<input type="text" id="fc-${p.id}" list="countryList" data-act="field" data-k="country" data-pid="${p.id}" value="${esc(p.country)}"></label>
          <label class="f">Program<input type="text" id="fn-${p.id}" data-act="field" data-k="name" data-pid="${p.id}" value="${esc(p.name)}"></label>
          <label class="f">Deadline<input type="date" id="fd-${p.id}" data-act="field" data-k="deadline" data-pid="${p.id}" value="${esc(p.deadline)}"></label>
          <label class="f">Application portal<input type="url" id="fp-${p.id}" data-act="field" data-k="portal" data-pid="${p.id}" value="${esc(p.portal)}" placeholder="https://"></label>
        </div>
        <div class="block">
          <div class="blockhead"><h3>What the school asks for</h3><span class="small muted">${(p.reqs || []).filter((q) => q.done).length} of ${(p.reqs || []).length} done</span></div>
          <div class="reqs">${reqHtml}</div>
          <form class="addreq" data-addreq="${p.id}">
            <input type="text" id="nr-${p.id}" placeholder="Add an item, e.g. Research statement" aria-label="New item">
            <select id="nl-${p.id}" aria-label="Importance">${LEVELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
            <button type="submit" class="ghost">Add item</button>
          </form>
        </div>
        <div class="block">
          <div class="blockhead"><h3>Letters for this school</h3><span class="small muted">Tick who writes for ${esc(p.school)}</span></div>
          <div class="assign">${asHtml}</div>
        </div>
        <label class="f">Notes (private, never shown to recommenders)<textarea id="fno-${p.id}" data-act="field" data-k="notes" data-pid="${p.id}" placeholder="Faculty to mention, fee waiver steps, contact person…">${esc(p.notes)}</textarea></label>
        <div class="pfoot">
          <div class="row">
            <button type="button" class="submit-btn ${p.submitted ? "on" : "ghost"}" data-act="submit" data-pid="${p.id}">${p.submitted ? "✓ Submitted" : "Mark as submitted"}</button>
            ${p.portal ? `<a href="${esc(p.portal)}" target="_blank" rel="noopener" class="small" style="color:var(--accent);font-weight:600">Open portal ↗</a>` : ""}
          </div>
          <button type="button" class="danger${armed === "p:" + p.id ? " armed" : ""}" data-act="delprog" data-pid="${p.id}">${armed === "p:" + p.id ? "Click again to remove" : "Remove program"}</button>
        </div>
      </div></details>`;
  }).join("");
}

const lastName = (n) => { const parts = String(n).trim().split(/\s+/); return parts[parts.length - 1] || n; };
function draftFor(r) {
  const pend = sorted().filter((p) => !p.submitted && ["request", "registered"].includes(letterOf(p, r)));
  const lines = pend.map((p) => `- ${p.school}${p.country ? " (" + p.country + ")" : ""}: due ${fmt(p.deadline)}`).join("\n") || "- (no pending letters)";
  return `Subject: Gentle reminder: recommendation letters

Dear Professor ${lastName(r.name)},

I hope you are doing well. I wanted to send a gentle reminder about the recommendation letters for my PhD applications, and to thank you again for supporting me.

The letters still pending are:
${lines}

Each school should have sent you its upload link directly. I also set up a small private page where you can see every school and deadline in one place, and tick each letter off once it is submitted:
${shareUrl(r)}

If a link is missing, or if it would help to have my CV, statement or writing sample again, please let me know and I will send it right away.

Thank you so much for your time and support.

Warm regards,
${profile.name || "Emile Djohi"}`;
}

function renderRecs() {
  const el = $("recList");
  if (!recs.length) { el.innerHTML = '<div class="card empty">Add the people writing your letters above. Each one gets a private link to their own space.</div>'; return; }
  el.innerHTML = recs.map((r) => {
    const ps = sorted().filter((p) => letterOf(p, r) !== "none");
    const done = ps.filter((p) => letterOf(p, r) === "submitted").length;
    const seen = shares[r.token]?.lastUpdateBy === "recommender";
    const tg = (k, l) => `<label class="tg${r[k] ? " on" : ""}"><input type="checkbox" id="t${k}-${r.id}" data-act="rflag" data-rid="${r.id}" data-k="${k}"${r[k] ? " checked" : ""}>${l}</label>`;
    return `<article class="card rcard">
      <div class="rtop">
        <div class="who"><h3>${esc(r.name)}</h3><span class="small muted">${esc(r.affiliation)}</span></div>
        <span class="pill ${ps.length && done === ps.length ? "done" : done ? "mid" : ""}">${done}/${ps.length} letters in</span>
      </div>
      <div class="fields">
        <label class="f">Name<input type="text" id="rn-${r.id}" data-act="rfield" data-k="name" data-rid="${r.id}" value="${esc(r.name)}"></label>
        <label class="f">Email<input type="email" id="re-${r.id}" data-act="rfield" data-k="email" data-rid="${r.id}" value="${esc(r.email)}" placeholder="name@university.edu"></label>
        <label class="f">Affiliation<input type="text" id="raf-${r.id}" data-act="rfield" data-k="affiliation" data-rid="${r.id}" value="${esc(r.affiliation)}"></label>
      </div>
      <div class="toggles">${tg("asked", "Agreed to write")}${tg("packet", "Packet sent")}${tg("thanked", "Thank-you sent")}</div>
      <div class="schools">${ps.length ? ps.map((p) => {
        const s = letterOf(p, r);
        return `<div class="sch${s === "submitted" ? " done" : ""}"><span><b>${esc(p.school)}</b> <span class="small muted">· ${esc(p.country || "")} · ${fmt(p.deadline, { month: "short", day: "numeric" })}</span></span>${duePill(p.deadline, p.submitted)}<span class="pill ${s === "submitted" ? "done" : s === "registered" ? "opt" : "rec"}">${LSTAT.find((x) => x[0] === s)?.[1] ?? "To request"}</span></div>`;
      }).join("") : '<span class="small muted">Not assigned to any school yet. Assign from each program.</span>'}</div>
      <div class="sharebox">
        <span class="eyebrow" style="color:var(--accent)">Their private space</span>
        <span class="url" id="su-${r.id}">${esc(shareUrl(r))}</span>
        <div class="row">
          <button type="button" data-act="copylink" data-rid="${r.id}">Copy link</button>
          <a class="btn ghost" href="${esc(shareUrl(r))}" target="_blank" rel="noopener">Preview ↗</a>
          <span class="small muted" id="sn-${r.id}">${seen ? "They have updated their page." : "Only people with this link can open it."}</span>
        </div>
      </div>
      ${drafts.has(r.id) ? `<div class="draft">
        <span class="eyebrow">Polite reminder, ready to send</span>
        ${r.email ? `<div class="small">To: <span class="mono" style="user-select:all">${esc(r.email)}</span></div>` : '<span class="small muted">Add their email above so it shows here.</span>'}
        <textarea id="dr-${r.id}" aria-label="Reminder email">${esc(draftFor(r))}</textarea>
        <div class="row"><button type="button" data-act="copydraft" data-rid="${r.id}">Copy email</button><button type="button" class="quiet" data-act="draft" data-rid="${r.id}">Close</button><span class="small muted" id="cp-${r.id}"></span></div>
      </div>` : ""}
      <div class="pfoot">
        <button type="button" class="ghost" data-act="draft" data-rid="${r.id}">${drafts.has(r.id) ? "Hide reminder" : "Draft reminder email"}</button>
        <button type="button" class="danger${armed === "r:" + r.id ? " armed" : ""}" data-act="delrec" data-rid="${r.id}">${armed === "r:" + r.id ? "Click again to remove" : "Remove recommender"}</button>
      </div></article>`;
  }).join("");
}

function renderLinks() {
  const portals = sorted().filter((p) => p.portal).map((p) => ({ id: "portal-" + p.id, label: p.school + " application portal", url: p.portal, category: "Application portals (from programs)", auto: true }));
  const all = [...portals, ...links];
  if (!all.length) { $("linkList").innerHTML = '<div class="card empty">Save your first link above. Portals you add on a program also appear here automatically.</div>'; return; }
  const groups = {}; for (const l of all) (groups[l.category || "Other"] ??= []).push(l);
  $("linkList").innerHTML = Object.entries(groups).map(([g, ls]) => `<div class="lgroup"><span class="eyebrow">${esc(g)}</span><div class="card">${ls.map((l) => `<div class="lk">
      <div style="display:grid;min-width:0"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a><span class="u">${esc(l.url)}</span></div>
      ${l.auto ? '<span class="small muted">Edit in program</span>' : `<button type="button" class="danger${armed === "l:" + l.id ? " armed" : ""}" data-act="dellink" data-lid="${l.id}">${armed === "l:" + l.id ? "Click again" : "Remove"}</button>`}
    </div>`).join("")}</div></div>`).join("");
}

function renderProfile() {
  document.querySelectorAll("[data-pf]").forEach((el) => { if (el !== document.activeElement) el.value = profile[el.dataset.pf] || ""; });
}

function renderAll() {
  const a = document.activeElement, fid = a && a.id;
  const val = a && "value" in a && a.type !== "checkbox" ? a.value : null, pos = a && a.selectionStart;
  renderHero(); renderOverview(); renderPrograms(); renderRecs(); renderLinks();
  if (fid) {
    const n = document.getElementById(fid);
    if (n && n !== document.activeElement) {
      if (val !== null && n.tagName !== "SELECT") n.value = val;
      n.focus();
      try { if (pos != null) n.setSelectionRange(pos, pos); } catch {}
    }
  }
}

/* ---------- Tabs ---------- */
function route() {
  const t = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  for (const x of TABS) {
    $("v-" + x).hidden = x !== t;
    document.querySelector(`[data-tab="${x}"]`).setAttribute("aria-current", x === t ? "page" : "false");
  }
}
window.addEventListener("hashchange", route);

/* ---------- Events ---------- */
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.matches && d.matches("details.prog")) d.open ? openSet.add(d.dataset.id) : openSet.delete(d.dataset.id);
}, true);

document.addEventListener("change", (e) => {
  const t = e.target, act = t.dataset.act;
  if (t.dataset.pf) {
    const k = t.dataset.pf, v = t.value.trim();
    safe(async () => {
      await setDoc(doc(db, "settings", "profile"), { [k]: v }, { merge: true });
      profile = { ...profile, [k]: v };
      const b = writeBatch(db);
      recs.forEach((r) => b.update(doc(db, "shares", r.token), shareBase()));
      await b.commit();
      $("pfSaved").textContent = "Saved. Recommender pages are updated.";
    });
    return;
  }
  if (!act) return;
  const p = P(t.dataset.pid), r = R(t.dataset.rid);
  if (act === "field") updateProgram(t.dataset.pid, { [t.dataset.k]: t.value.trim() });
  else if (act === "reqdone") setReqs(t.dataset.pid, (a) => a.map((q) => (q.id === t.dataset.qid ? { ...q, done: t.checked } : q)));
  else if (act === "reqlevel") setReqs(t.dataset.pid, (a) => a.map((q) => (q.id === t.dataset.qid ? { ...q, level: t.value } : q)));
  else if (act === "assign") assign(p, r, t.checked);
  else if (act === "lstat") setLetter(p, r, t.value);
  else if (act === "rflag") safe(() => updateDoc(doc(db, "recommenders", r.id), { [t.dataset.k]: t.checked }));
  else if (act === "rfield") {
    const v = t.value.trim();
    safe(async () => {
      await updateDoc(doc(db, "recommenders", r.id), { [t.dataset.k]: v });
      if (t.dataset.k === "name") await updateDoc(doc(db, "shares", r.token), { name: v });
    });
  }
});

function arm(key) { armed = key; renderAll(); setTimeout(() => { if (armed === key) { armed = null; renderAll(); } }, 4000); }

document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-country]");
  if (c) { country = c.dataset.country; renderPrograms(); return; }
  const g = e.target.closest("[data-goto]");
  if (g) {
    openSet.add(g.dataset.goto); country = "All";
    setTimeout(() => { renderPrograms(); $("prog-" + g.dataset.goto)?.scrollIntoView({ block: "start", behavior: "smooth" }); }, 0);
    return;
  }
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const act = b.dataset.act;
  if (act === "reqdel") setReqs(b.dataset.pid, (a) => a.filter((q) => q.id !== b.dataset.qid));
  else if (act === "submit") updateProgram(b.dataset.pid, { submitted: !P(b.dataset.pid).submitted });
  else if (act === "delprog") {
    const k = "p:" + b.dataset.pid;
    if (armed !== k) return arm(k);
    armed = null; const p = P(b.dataset.pid); openSet.delete(p.id);
    safe(async () => {
      const bt = writeBatch(db);
      assigned(p).forEach((r) => bt.update(doc(db, "shares", r.token), { [`programs.${p.id}`]: deleteField(), [`letters.${p.id}`]: deleteField() }));
      bt.delete(doc(db, "programs", p.id));
      await bt.commit();
    });
  } else if (act === "delrec") {
    const k = "r:" + b.dataset.rid;
    if (armed !== k) return arm(k);
    armed = null; const r = R(b.dataset.rid);
    safe(async () => { const bt = writeBatch(db); bt.delete(doc(db, "shares", r.token)); bt.delete(doc(db, "recommenders", r.id)); await bt.commit(); });
  } else if (act === "dellink") {
    const k = "l:" + b.dataset.lid;
    if (armed !== k) return arm(k);
    armed = null; safe(() => deleteDoc(doc(db, "links", b.dataset.lid)));
  } else if (act === "draft") {
    drafts.has(b.dataset.rid) ? drafts.delete(b.dataset.rid) : drafts.add(b.dataset.rid); renderRecs();
  } else if (act === "copydraft") {
    copyText($("dr-" + b.dataset.rid).value, $("cp-" + b.dataset.rid), $("dr-" + b.dataset.rid));
  } else if (act === "copylink") {
    copyText(shareUrl(R(b.dataset.rid)), $("sn-" + b.dataset.rid));
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target; e.preventDefault();
  if (f.id === "addProg") {
    const school = $("apSchool").value.trim(); if (!school) return;
    $("apBtn").disabled = true;
    await safe(async () => {
      const data = { school, country: $("apCountry").value.trim(), name: $("apName").value.trim(), deadline: $("apDate").value,
        portal: "", notes: "", submitted: false, created: Date.now(),
        reqs: DEFAULT_REQS.map(([label, level]) => ({ id: uid(), label, level, done: false })) };
      const ref = await addDoc(collection(db, "programs"), data);
      const bt = writeBatch(db);
      recs.forEach((r) => bt.update(doc(db, "shares", r.token), { [`programs.${ref.id}`]: summary(data), [`letters.${ref.id}`]: "request" }));
      await bt.commit();
      openSet.add(ref.id); f.reset();
    });
    $("apBtn").disabled = false;
  } else if (f.id === "addRec") {
    const name = $("arName").value.trim(); if (!name) return;
    await safe(async () => {
      const token = randomToken();
      const ref = doc(collection(db, "recommenders"));
      const bt = writeBatch(db);
      bt.set(ref, { name, affiliation: $("arAff").value.trim(), email: $("arEmail").value.trim(), asked: false, packet: false, thanked: false, order: Date.now(), token });
      bt.set(doc(db, "shares", token), { name, ...shareBase(), programs: {}, letters: {}, lastUpdateBy: "owner" });
      await bt.commit();
      f.reset();
    });
  } else if (f.id === "addLink") {
    let url = $("alUrl").value.trim(); if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    await safe(async () => { await addDoc(collection(db, "links"), { label: $("alLabel").value.trim() || url, url, category: $("alCat").value, order: Date.now() }); f.reset(); });
  } else if (f.dataset.addreq) {
    const pid = f.dataset.addreq, inp = $("nr-" + pid), label = inp.value.trim(); if (!label) return;
    setReqs(pid, (a) => [...a, { id: uid(), label, level: $("nl-" + pid).value, done: false }]);
    inp.value = "";
  }
});

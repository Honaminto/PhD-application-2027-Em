import { doc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configured, $, esc, fmt, daysLeft, dateBox, duePill, byDeadline } from "./common.js";

const token = new URLSearchParams(location.search).get("k");
let data = null;

const lastName = (n) => { const p = String(n || "").trim().split(/\s+/); return p[p.length - 1] || ""; };
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "the applicant";

function fail(title, text) {
  $("rsTitle").textContent = title;
  $("rsIntro").textContent = text;
  $("rsBody").hidden = true;
}

function render() {
  const owner = data.ownerName || "the applicant";
  document.title = `Letters for ${owner}`;
  $("rsEyebrow").textContent = `Recommendation letters · ${owner}`;
  $("rsTitle").textContent = `Thank you, Professor ${lastName(data.name)}`;
  $("rsIntro").textContent = `Here are the schools where you are writing for ${firstName(owner)}, with each deadline. When you upload a letter, tap "Mark as submitted" and ${firstName(owner)} will see it right away.`;
  $("rsBody").hidden = false;

  const items = Object.entries(data.programs || {})
    .map(([id, p]) => ({ id, ...p, status: (data.letters || {})[id] || "request" }))
    .sort(byDeadline);
  const done = items.filter((i) => i.status === "submitted").length;
  $("rsDone").innerHTML = `${done}<span>/${items.length}</span>`;
  $("rsMeter").querySelector("i").style.width = (items.length ? (done / items.length) * 100 : 0) + "%";
  $("rsMeter").classList.toggle("done", items.length > 0 && done === items.length);
  const next = items.find((i) => i.status !== "submitted" && daysLeft(i.deadline) !== null && daysLeft(i.deadline) >= 0);
  $("rsNext").textContent = next ? daysLeft(next.deadline) + "d" : "–";
  $("rsNextS").textContent = next ? next.school : items.length && done === items.length ? "All done" : "";
  $("rsCount").textContent = items.length;
  $("rsCountries").textContent = [...new Set(items.map((i) => i.country).filter(Boolean))].join(", ");

  $("rsList").innerHTML = items.length ? items.map((i) => {
    const sub = i.status === "submitted", reg = i.status === "registered";
    return `<article class="card rs-item st-${i.status}">
      ${dateBox(i.deadline)}
      <div class="ptitle">
        <b>${esc(i.school)}</b>
        <div class="sub">${i.country ? `<span class="pill flag">${esc(i.country)}</span>` : ""}<span>${esc(i.name || "PhD program")}</span></div>
        <div class="sub">${duePill(i.deadline, sub, "Letter submitted")}<span>Due ${esc(fmt(i.deadline))}</span></div>
      </div>
      <div class="actions">
        ${sub ? "" : `<button type="button" class="${reg ? "" : "ghost"}" data-set="${reg ? "request" : "registered"}" data-id="${i.id}" aria-pressed="${reg}">${reg ? "✓ Link received" : "I have the upload link"}</button>`}
        <button type="button" class="${sub ? "rs-done" : ""}" data-set="${sub ? "registered" : "submitted"}" data-id="${i.id}" aria-pressed="${sub}">${sub ? "✓ Submitted · undo" : "Mark as submitted"}</button>
      </div>
    </article>`;
  }).join("") : '<div class="card empty">No schools are assigned to you yet. They will appear here as soon as they are added.</div>';

  const m = data.materials || {};
  const mats = [["cv", "CV"], ["sop", "Statement of purpose"], ["ws", "Writing sample"], ["other", "Transcripts and other documents"]].filter(([k]) => m[k]);
  $("rsMatSec").hidden = !mats.length;
  $("rsMaterials").innerHTML = mats.map(([k, l]) => `<div class="lk"><a href="${esc(m[k])}" target="_blank" rel="noopener">${l} ↗</a><span></span></div>`).join("");
  $("rsFoot").innerHTML = `This page is private to you through this link. Please don't forward it.${data.ownerEmail ? ` Questions? Write to <span class="mono" style="user-select:all">${esc(data.ownerEmail)}</span>.` : ""}`;
}

function note(t) { const n = $("rsNote"); n.textContent = t || ""; n.hidden = !t; }

if (!configured) fail("Not set up yet", "This page has not been connected to its database.");
else if (!token) fail("Link incomplete", "This link is missing its access code. Please use the full link you received by email.");
else {
  const ref = doc(db, "shares", token);
  const timer = setTimeout(() => note("Still loading. If this persists, check your connection."), 10000);
  onSnapshot(ref, (s) => {
    clearTimeout(timer);
    if (!s.exists()) return fail("Link not found", "This link is no longer active. Please ask the applicant for a new one.");
    data = s.data(); note(""); render();
  }, () => { clearTimeout(timer); fail("Link not found", "This link is no longer active. Please ask the applicant for a new one."); });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-set]"); if (!b) return;
    b.disabled = true;
    try {
      await updateDoc(ref, { [`letters.${b.dataset.id}`]: b.dataset.set, lastUpdateBy: "recommender" });
    } catch {
      note("That update did not save. Please try again in a moment.");
      b.disabled = false;
    }
  });
}

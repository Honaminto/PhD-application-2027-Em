import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, OWNER_UID } from "./firebase-config.js";

export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE");
export const ownerConfigured = !String(OWNER_UID).startsWith("PASTE");
export const app = configured ? initializeApp(firebaseConfig) : null;
export const db = app ? getFirestore(app) : null;
export { OWNER_UID };

export const LSTAT = [
  ["request", "To request"],
  ["registered", "Upload link received"],
  ["submitted", "Submitted"],
];

export const $ = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysLeft(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 864e5);
}

export function fmt(iso, opts = { month: "long", day: "numeric", year: "numeric" }) {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString("en-US", opts) : "No date set";
}

export function dateBox(iso) {
  const d = parseDate(iso);
  return `<div class="datebox"><span class="m">${d ? d.toLocaleDateString("en-US", { month: "short" }) : "TBD"}</span><span class="d">${d ? d.getDate() : "–"}</span></div>`;
}

export function duePill(iso, done, doneLabel = "Submitted") {
  if (done) return `<span class="pill done">${doneLabel}</span>`;
  const n = daysLeft(iso);
  if (n === null) return '<span class="pill">No date</span>';
  if (n < 0) return '<span class="pill soon">Deadline passed</span>';
  const cls = n <= 10 ? "soon" : n <= 30 ? "mid" : "";
  return `<span class="pill ${cls}">${n === 0 ? "Due today" : n === 1 ? "1 day left" : n + " days left"}</span>`;
}

export function byDeadline(a, b) {
  return (a.deadline || "9999").localeCompare(b.deadline || "9999");
}

export function randomToken(len = 28) {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function copyText(text, noteEl, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (noteEl) noteEl.textContent = "Copied.";
  } catch {
    if (fallbackEl) { fallbackEl.focus(); fallbackEl.select(); }
    if (noteEl) noteEl.textContent = "Selected. Press Ctrl+C or ⌘C to copy.";
  }
}

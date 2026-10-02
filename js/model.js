export const TABS = [
  { id: "review", label: "To review", statuses: ["new", "pending"] },
  { id: "resume", label: "Resume queue", statuses: ["accepted"] },
  { id: "pipeline", label: "Pipeline", statuses: ["applied", "interview", "offer"] },
  { id: "closed", label: "Closed", statuses: ["rejected", "dismissed"] },
  { id: "stale", label: "Not seen recently", statuses: ["stale"] },
];

export const PIPELINE_STAGES = [
  { id: "applied", label: "Applied" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
];

export const STATUS_LABELS = {
  new: "New",
  pending: "New",
  accepted: "Resume queued",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  dismissed: "Not interested",
  stale: "Not seen recently",
};

// Jobs the user hasn't applied to yet: the only ones an Apply click can move forward.
export const PRE_APPLICATION_TABS = new Set(["review", "resume", "stale"]);

export function tabOf(status) {
  return (TABS.find((t) => t.statuses.includes(status)) || TABS[0]).id;
}

export function jobList(data) {
  return Object.values((data && data.jobs) || {});
}

export function safeUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function isNetherlands(job) {
  return String(job.country || "").trim().toLowerCase() === "netherlands";
}

export function sponsorshipMentioned(job) {
  const s = job.sponsorship_mentioned;
  return Boolean(s && typeof s === "object" ? s.mentioned : s);
}

export function compareJobs(a, b) {
  return (
    Number(isNetherlands(b)) - Number(isNetherlands(a)) ||
    Number(sponsorshipMentioned(b)) - Number(sponsorshipMentioned(a)) ||
    String(b.date_found || "").localeCompare(String(a.date_found || "")) ||
    String(a.title || "").localeCompare(String(b.title || ""))
  );
}

const SOON_DAYS = 7;

function isoDayNumber(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const check = new Date(ms);
  if (check.getUTCMonth() !== Number(match[2]) - 1 || check.getUTCDate() !== Number(match[3])) return null;
  return ms / 86400000;
}

// How long is left to apply. Works on calendar days only, so the user's timezone
// never shifts a deadline by one.
export function closingInfo(job, today) {
  const note = String(job.closing_date_note || "").trim();
  const due = isoDayNumber(job.closing_date);
  const now = isoDayNumber(today);
  if (due === null || now === null) return { date: null, daysLeft: null, state: "unknown", note };
  const daysLeft = due - now;
  const state = daysLeft < 0 ? "passed" : daysLeft <= SOON_DAYS ? "soon" : "open";
  return { date: String(job.closing_date).trim(), daysLeft, state, note };
}

export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// The first date a job reached a stage is kept, so moving back and forth
// (e.g. rejected -> applied to undo a mis-click) never loses the real date.
export function setStatus(data, jobIds, status, date) {
  let changed = 0;
  for (const id of jobIds) {
    const job = data.jobs && data.jobs[id];
    if (!job || job.status === status) continue;
    job.status = status;
    if (status !== "new") {
      const dates = { ...(job.stage_dates || {}) };
      if (!dates[status]) dates[status] = date;
      job.stage_dates = dates;
    }
    changed++;
  }
  return changed;
}

export function setNote(data, jobId, note) {
  const job = data.jobs && data.jobs[jobId];
  const clean = String(note).trim();
  if (!job || (job.user_notes || "") === clean) return false;
  if (clean) job.user_notes = clean;
  else delete job.user_notes;
  return true;
}

export function restoreStatus(job) {
  return job.status === "rejected" ? "applied" : "new";
}

export function matchesFilters(job, { query, country }) {
  if (country && job.country !== country) return false;
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [job.title, job.company, job.location, job.country, job.job_description_summary]
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function formatTweak(tweak) {
  if (typeof tweak === "string") return tweak;
  if (tweak && typeof tweak === "object") {
    if (tweak.text) return String(tweak.text);
    if (Array.isArray(tweak.items)) return tweak.items.join(", ");
  }
  return JSON.stringify(tweak);
}

import { h, formatDate, formatDateTime } from "./ui.js";
import {
  TABS,
  PIPELINE_STAGES,
  STATUS_LABELS,
  PRE_APPLICATION_TABS,
  tabOf,
  jobList,
  safeUrl,
  isNetherlands,
  sponsorshipMentioned,
  compareJobs,
  todayIso,
  setStatus,
  setNote,
  restoreStatus,
  matchesFilters,
  formatTweak,
} from "./model.js";
import { PendingApplies } from "./pending.js";

const $ = (id) => document.getElementById(id);

const EMPTY_MESSAGES = {
  review: "No new jobs to review. The search runs every morning at 08:00 (South Africa time).",
  resume: "No jobs queued. Use “Tailor resume” on a job you like, then ask Claude to “process accepted jobs”.",
  pipeline: "No applications yet. Use Apply on a job — you'll be asked to confirm when you come back.",
  closed: "Nothing closed yet.",
  stale: "Every job was seen in the latest search.",
};

export function startApp(store, { signOut }) {
  const state = { tab: "review", query: "", country: "", busy: new Set(), drafts: new Map() };
  const pending = new PendingApplies();
  let awaitingReturn = false;
  let toastTimer = null;

  function toast(message, kind = "info") {
    const el = $("toast");
    el.textContent = message;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = "toast"), kind === "error" ? 8000 : 2500);
  }

  function describeError(e) {
    if (e.status === 401) return "GitHub rejected the access token (expired or revoked). Signing you out — re-run setup with a new token.";
    if (e.status === 403) return "GitHub refused the change. The token may lack Contents write permission, or the rate limit was hit.";
    if (e.status === 404) return "Couldn't find the jobs file. Check the repo, branch and path in setup.";
    if (e.status === 409 || e.status === 422) return "Someone else saved at the same moment. Refresh and try again.";
    return e.message || "Something went wrong.";
  }

  function commitMessage(action, jobs) {
    const what = jobs.length === 1 ? `${jobs[0].title} (${jobs[0].company})` : `${jobs.length} jobs`;
    return `Tracker: ${action} — ${what}`.slice(0, 120);
  }

  async function commit(jobIds, mutator, message) {
    jobIds.forEach((id) => state.busy.add(id));
    render();
    try {
      const changed = await store.mutate(mutator, message);
      toast(changed ? "Saved" : "Already up to date");
      return true;
    } catch (e) {
      toast(describeError(e), "error");
      if (e.status === 401) setTimeout(signOut, 4000);
      return false;
    } finally {
      jobIds.forEach((id) => state.busy.delete(id));
      render();
    }
  }

  function changeStatus(job, status) {
    const id = job.job_id;
    return commit([id], (d) => setStatus(d, [id], status, todayIso()) > 0, commitMessage(STATUS_LABELS[status], [job]));
  }

  async function saveNote(job) {
    const id = job.job_id;
    const note = state.drafts.get(id) ?? job.user_notes ?? "";
    if (await commit([id], (d) => setNote(d, id, note), commitMessage("Note", [job]))) state.drafts.delete(id);
  }

  async function downloadResume(job) {
    state.busy.add(job.job_id);
    render();
    try {
      const blob = await store.downloadResume(job.job_id);
      const name = `Resume - ${job.company} - ${job.title}`.replace(/[^\w\- ]+/g, "").slice(0, 80).trim();
      const link = h("a", { href: URL.createObjectURL(blob), download: `${name}.docx` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    } catch (e) {
      toast(describeError(e), "error");
    } finally {
      state.busy.delete(job.job_id);
      render();
    }
  }

  function recordApplyClick(job) {
    pending.add(job.job_id);
    awaitingReturn = true;
    renderBanner();
  }

  // ---- apply confirmation ----

  function openApplyDialog() {
    const dialog = $("apply-dialog");
    const jobs = pending.ids.map((id) => store.data.jobs[id]).filter(Boolean);
    if (!jobs.length) {
      if (dialog.open) dialog.close();
      return;
    }
    $("apply-list").replaceChildren(
      ...jobs.map((job) =>
        h(
          "li",
          { class: "apply-item" },
          h(
            "label",
            { class: "apply-label" },
            h("input", { type: "checkbox", value: job.job_id }),
            h("span", {}, h("strong", { text: job.title || "Untitled role" }), h("span", { class: "muted", text: ` — ${job.company || ""}` })),
          ),
          h("button", {
            type: "button",
            class: "btn btn-ghost btn-sm",
            text: "Didn't apply",
            onclick: () => {
              pending.remove([job.job_id]);
              openApplyDialog();
              renderBanner();
            },
          }),
        ),
      ),
    );
    if (!dialog.open) dialog.showModal();
  }

  async function confirmApplied() {
    const ids = [...$("apply-list").querySelectorAll("input:checked")].map((input) => input.value);
    if (!ids.length) {
      toast("Tick the jobs you applied to, or choose “Ask me later”.");
      return;
    }
    $("apply-dialog").close();
    const jobs = ids.map((id) => store.data.jobs[id]).filter(Boolean);
    const ok = await commit(ids, (d) => setStatus(d, ids, "applied", todayIso()) > 0, commitMessage("Applied", jobs));
    if (ok) {
      pending.remove(ids);
      toast(`Moved ${ids.length} job${ids.length === 1 ? "" : "s"} to your pipeline`);
      render();
    }
  }

  // ---- views ----

  const badge = (text, kind) => h("span", { class: `badge badge-${kind}`, text });

  function applyLink(job, busy, label = "Apply ↗", className = "btn btn-primary") {
    const url = safeUrl(job.url);
    if (!url) return h("span", { class: "muted small", text: "No link available" });
    const record = () => recordApplyClick(job);
    return h("a", {
      class: `${className}${busy ? " is-disabled" : ""}`,
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      "aria-disabled": busy ? "true" : null,
      onclick: PRE_APPLICATION_TABS.has(tabOf(job.status)) ? record : null,
      onauxclick: PRE_APPLICATION_TABS.has(tabOf(job.status)) ? record : null,
      text: label,
    });
  }

  function viewLink(job) {
    const url = safeUrl(job.url);
    return url ? h("a", { class: "link", href: url, target: "_blank", rel: "noopener noreferrer", text: "View posting ↗" }) : null;
  }

  function button(text, onclick, { kind = "secondary", busy = false, size = "" } = {}) {
    return h("button", { type: "button", class: `btn btn-${kind}${size ? ` btn-${size}` : ""}`, disabled: busy, onclick, text });
  }

  function detailSection(title, content) {
    return content ? h("div", { class: "detail" }, h("h4", { text: title }), content) : null;
  }

  function jobDetails(job) {
    const requirements = (job.requirements || []).filter(Boolean);
    const tweaks = (job.suggested_resume_tweaks || []).map(formatTweak).filter(Boolean);
    const sponsorship = job.sponsorship_mentioned && typeof job.sponsorship_mentioned === "object" ? job.sponsorship_mentioned.detail : "";
    const sections = [
      detailSection("Requirements", requirements.length ? h("ul", {}, requirements.map((r) => h("li", { text: r }))) : null),
      detailSection("Visa / sponsorship", job.visa_note || sponsorship ? h("p", { text: [sponsorship, job.visa_note].filter(Boolean).join(" ") }) : null),
      detailSection("Suggested resume tweaks", tweaks.length ? h("ul", {}, tweaks.map((t) => h("li", { text: t }))) : null),
      detailSection("Search notes", job.notes ? h("p", { text: job.notes }) : null),
      detailSection(
        "Found",
        h("p", {
          text: [
            job.source ? `Source: ${job.source}` : "",
            job.date_found ? `first seen ${formatDate(job.date_found)}` : "",
            job.date_last_seen ? `last seen ${formatDate(job.date_last_seen)}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        }),
      ),
    ].filter(Boolean);
    return h("details", { class: "details" }, h("summary", { text: "More details" }), sections);
  }

  function metaLine(job) {
    const place = [job.location, job.country].filter(Boolean).join(", ");
    return [job.company, place].filter(Boolean).join(" · ");
  }

  function jobCard(job) {
    const busy = state.busy.has(job.job_id);
    const hasResume = store.resumes.has(job.job_id);
    const badges = [
      isNetherlands(job) ? badge("Netherlands", "nl") : null,
      sponsorshipMentioned(job) ? badge("Sponsorship mentioned", "ok") : null,
      job.status === "stale" ? badge("Not seen in latest search", "warn") : null,
      job.status === "accepted" ? badge(hasResume ? "Tailored resume ready" : "Resume queued", hasResume ? "ok" : "neutral") : null,
      job.status === "rejected" || job.status === "dismissed" ? badge(STATUS_LABELS[job.status], "neutral") : null,
    ].filter(Boolean);

    let actions;
    if (job.status === "accepted") {
      actions = [
        applyLink(job, busy),
        hasResume
          ? button("Download tailored resume", () => downloadResume(job), { busy })
          : h("span", { class: "muted small", text: "Ask Claude to “process accepted jobs” to get the tailored resume." }),
        button("Not interested", () => changeStatus(job, "dismissed"), { kind: "ghost", busy }),
      ];
    } else if (job.status === "rejected" || job.status === "dismissed") {
      const closedOn = job.stage_dates && job.stage_dates[job.status];
      actions = [
        button(job.status === "rejected" ? "Move back to pipeline" : "Move back to review", () => changeStatus(job, restoreStatus(job)), { busy }),
        viewLink(job),
        closedOn ? h("span", { class: "muted small", text: `Closed ${formatDate(closedOn)}` }) : null,
      ];
    } else {
      actions = [
        applyLink(job, busy),
        button("Tailor resume", () => changeStatus(job, "accepted"), { busy }),
        button("Not interested", () => changeStatus(job, "dismissed"), { kind: "ghost", busy }),
      ];
    }

    return h(
      "article",
      { class: `card${isNetherlands(job) ? " card-nl" : ""}${busy ? " is-busy" : ""}`, "data-job-id": job.job_id },
      badges.length ? h("div", { class: "badges" }, badges) : null,
      h("h3", { class: "card-title", text: job.title || "Untitled role" }),
      h("p", { class: "card-meta", text: metaLine(job) }),
      job.job_description_summary ? h("p", { class: "card-summary", text: job.job_description_summary }) : null,
      jobDetails(job),
      h("div", { class: "actions" }, actions),
    );
  }

  function stageDates(job) {
    const dates = job.stage_dates || {};
    const order = PIPELINE_STAGES.map((s) => s.id);
    const upTo = order.indexOf(job.status);
    return order
      .slice(0, upTo + 1)
      .filter((stage) => dates[stage])
      .map((stage) => `${STATUS_LABELS[stage]} ${formatDate(dates[stage])}`)
      .join(" · ");
  }

  function pipelineCard(job) {
    const id = job.job_id;
    const busy = state.busy.has(id);
    const saved = job.user_notes || "";
    const draft = state.drafts.get(id) ?? saved;
    const saveBtn = button("Save note", () => saveNote(job), { busy: busy || draft.trim() === saved, size: "sm" });
    const notes = h("textarea", {
      class: "notes",
      rows: "2",
      placeholder: "Notes — interview date, contact person…",
      "aria-label": `Notes for ${job.title}`,
      value: draft,
      oninput: (e) => {
        state.drafts.set(id, e.target.value);
        saveBtn.disabled = busy || e.target.value.trim() === saved;
      },
    });
    const stages = [...PIPELINE_STAGES, { id: "rejected", label: "Rejected" }];
    return h(
      "article",
      { class: `card card-compact${isNetherlands(job) ? " card-nl" : ""}${busy ? " is-busy" : ""}`, "data-job-id": id },
      h("h3", { class: "card-title", text: job.title || "Untitled role" }),
      h("p", { class: "card-meta", text: metaLine(job) }),
      h("p", { class: "muted small", text: stageDates(job) }),
      h(
        "label",
        { class: "stage-label" },
        h("span", { class: "small", text: "Stage" }),
        h(
          "select",
          { class: "stage-select", disabled: busy, onchange: (e) => changeStatus(job, e.target.value) },
          stages.map((s) => h("option", { value: s.id, selected: s.id === job.status, text: s.label })),
        ),
      ),
      notes,
      h(
        "div",
        { class: "actions" },
        saveBtn,
        viewLink(job),
        store.resumes.has(id) ? button("Resume", () => downloadResume(job), { kind: "ghost", busy, size: "sm" }) : null,
      ),
    );
  }

  function renderPipeline(jobs) {
    return h(
      "div",
      { class: "board" },
      PIPELINE_STAGES.map((stage) => {
        const column = jobs.filter((j) => j.status === stage.id);
        return h(
          "section",
          { class: "column", "aria-label": stage.label },
          h("header", { class: "column-head" }, h("h2", { text: stage.label }), h("span", { class: "count", text: String(column.length) })),
          column.length ? column.map(pipelineCard) : h("p", { class: "column-empty", text: "Nothing here yet" }),
        );
      }),
    );
  }

  function renderTabs(jobs) {
    const counts = Object.fromEntries(TABS.map((t) => [t.id, 0]));
    for (const job of jobs) counts[tabOf(job.status)]++;
    $("tabs").replaceChildren(
      ...TABS.map((tab) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: "tab",
            "aria-selected": String(tab.id === state.tab),
            onclick: () => {
              state.tab = tab.id;
              render();
            },
          },
          h("span", { text: tab.label }),
          h("span", { class: "tab-count", text: String(counts[tab.id]) }),
        ),
      ),
    );
  }

  function renderCountries(jobs) {
    const counts = new Map();
    for (const job of jobs) if (job.country) counts.set(job.country, (counts.get(job.country) || 0) + 1);
    if (state.country && !counts.has(state.country)) state.country = "";
    const options = [...counts.keys()].sort().map((c) => h("option", { value: c, selected: c === state.country, text: `${c} (${counts.get(c)})` }));
    $("country").replaceChildren(h("option", { value: "", text: "All countries" }), ...options);
  }

  function renderBanner() {
    const n = pending.ids.length;
    $("pending-banner").hidden = n === 0;
    $("pending-text").textContent = `You opened ${n} job site${n === 1 ? "" : "s"}. Did you apply?`;
  }

  function renderContent(jobs) {
    const tab = TABS.find((t) => t.id === state.tab);
    const inTab = jobs.filter((j) => tab.statuses.includes(j.status));
    const shown = inTab.filter((j) => matchesFilters(j, state)).sort(compareJobs);
    const content = $("content");
    if (!shown.length) {
      content.replaceChildren(h("p", { class: "empty", text: inTab.length ? "No jobs match your filters." : EMPTY_MESSAGES[tab.id] }));
    } else if (tab.id === "pipeline") {
      content.replaceChildren(renderPipeline(shown));
    } else {
      content.replaceChildren(h("div", { class: "card-list" }, shown.map(jobCard)));
    }
  }

  function render() {
    const jobs = jobList(store.data);
    pending.keepOnly(new Set(jobs.filter((j) => PRE_APPLICATION_TABS.has(tabOf(j.status))).map((j) => j.job_id)));
    const lastRun = store.data && store.data.last_run;
    $("last-run").textContent = lastRun ? `Last search: ${formatDateTime(lastRun)}` : "No searches yet";
    renderTabs(jobs);
    renderCountries(jobs);
    renderBanner();
    renderContent(jobs);
  }

  // ---- wiring ----

  $("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderContent(jobList(store.data));
  });
  $("country").addEventListener("change", (e) => {
    state.country = e.target.value;
    renderContent(jobList(store.data));
  });
  $("refresh-btn").addEventListener("click", async () => {
    try {
      await store.load();
      render();
      toast("Up to date");
    } catch (e) {
      toast(describeError(e), "error");
    }
  });
  $("signout-btn").addEventListener("click", signOut);
  $("pending-btn").addEventListener("click", openApplyDialog);
  $("apply-confirm").addEventListener("click", confirmApplied);
  $("apply-later").addEventListener("click", () => $("apply-dialog").close());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && awaitingReturn && pending.ids.length) {
      awaitingReturn = false;
      openApplyDialog();
    }
  });

  render();
  return { render, openApplyDialog, state };
}

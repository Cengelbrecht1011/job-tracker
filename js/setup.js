import { encryptConfig, decryptConfig } from "./crypto.js";
import { GitHubRepo } from "./github.js";

const $ = (id) => document.getElementById(id);

function readForm() {
  return {
    username: $("username").value.trim(),
    password: $("password").value,
    confirm: $("confirm").value,
    token: $("token").value.trim(),
    owner: $("owner").value.trim(),
    repo: $("repo").value.trim(),
    branch: $("branch").value.trim() || "main",
    jobsPath: $("jobs-path").value.trim() || "JobList/jobs.json",
  };
}

function setStatus(message, kind = "") {
  const el = $("status");
  el.textContent = message;
  el.className = `setup-status ${kind}`;
}

async function checkAccess({ token, owner, repo, branch, jobsPath }) {
  if (!token || !owner || !repo) throw new Error("Fill in the token, repo owner and repo name first.");
  const { text } = await new GitHubRepo({ token, owner, repo, branch }).getFile(jobsPath);
  const count = Object.keys(JSON.parse(text).jobs || {}).length;
  return `Access OK — found ${count} jobs in ${owner}/${repo} (${branch}).`;
}

function describe(e) {
  if (e.status === 401) return "GitHub rejected the token. Check you copied all of it.";
  if (e.status === 403 || e.status === 404) return "The token can't see that file. Check the repo owner/name, branch, and that the token has access to this repo.";
  return e.message;
}

$("check").addEventListener("click", async () => {
  setStatus("Checking…");
  try {
    setStatus(await checkAccess(readForm()), "ok");
  } catch (e) {
    setStatus(describe(e), "error");
  }
});

$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = readForm();
  if (form.password.length < 12) return setStatus("Use a password of at least 12 characters.", "error");
  if (form.password !== form.confirm) return setStatus("The passwords don't match.", "error");
  try {
    setStatus("Checking access…");
    await checkAccess(form);
    setStatus("Encrypting (takes a second)…");
    const config = {
      token: form.token,
      owner: form.owner,
      repo: form.repo,
      branch: form.branch,
      jobsPath: form.jobsPath,
      createdAt: new Date().toISOString(),
    };
    const envelope = await encryptConfig(config, form.username, form.password);
    const check = await decryptConfig(envelope, form.username, form.password);
    if (!check || check.token !== form.token) throw new Error("Encryption self-check failed — please try again.");
    $("output").value = `${JSON.stringify(envelope, null, 2)}\n`;
    $("output-section").hidden = false;
    for (const id of ["password", "confirm", "token"]) $(id).value = "";
    setStatus("Login file created. Download it below.", "ok");
  } catch (e) {
    setStatus(describe(e), "error");
  }
});

$("download").addEventListener("click", () => {
  const blob = new Blob([$("output").value], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "config.enc.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
});

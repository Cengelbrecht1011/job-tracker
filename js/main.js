import { decryptConfig } from "./crypto.js";
import { GitHubRepo } from "./github.js";
import { JobStore } from "./store.js";
import { startApp } from "./app.js";

const SESSION_KEY = "jobtracker.session";
const $ = (id) => document.getElementById(id);

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function writeSession(config) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(config));
  } catch {
    // storage blocked: the user just signs in again after a reload
  }
}

function signOut() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing stored
  }
  location.reload();
}

function loginError(e) {
  if (e.status === 401) return "The saved GitHub token was rejected (expired or revoked). Re-run setup with a new token.";
  if (e.status === 404) return "Signed in, but the jobs file wasn't found. Re-run setup and check the repo details.";
  if (e.status === 0) return e.message;
  return `Signed in, but loading jobs failed: ${e.message}`;
}

async function loadEnvelope() {
  try {
    const res = await fetch("config.enc.json", { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function openDashboard(config) {
  const store = new JobStore(new GitHubRepo(config), config.jobsPath || "JobList/jobs.json");
  await store.load();
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  startApp(store, { signOut });
}

function showLoginError(message) {
  const el = $("login-error");
  el.textContent = message;
  el.hidden = !message;
}

async function init() {
  const session = readSession();
  if (session) {
    try {
      await openDashboard(session);
      return;
    } catch (e) {
      sessionStorage.removeItem(SESSION_KEY);
      $("login-view").hidden = false;
      showLoginError(loginError(e));
    }
  }
  $("login-view").hidden = false;

  const envelope = await loadEnvelope();
  if (!envelope) {
    $("setup-note").hidden = false;
    $("login-form").querySelectorAll("input, button").forEach((el) => (el.disabled = true));
    return;
  }

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("login-submit");
    submit.disabled = true;
    submit.textContent = "Signing in…";
    showLoginError("");
    try {
      const config = await decryptConfig(envelope, $("login-username").value, $("login-password").value);
      if (!config) {
        showLoginError("Wrong username or password.");
        return;
      }
      await openDashboard(config);
      writeSession(config);
    } catch (e) {
      showLoginError(loginError(e));
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });
  $("login-username").focus();
}

init();

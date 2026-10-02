import { b64ToBytes, bytesToB64 } from "./crypto.js";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const utf8ToB64 = (text) => bytesToB64(new TextEncoder().encode(text));
const b64ToUtf8 = (b64) => new TextDecoder().decode(b64ToBytes(b64));

export class GitHubRepo {
  constructor({ token, owner, repo, branch = "main" }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
  }

  headers(accept = "application/vnd.github+json") {
    return { Authorization: `Bearer ${this.token}`, Accept: accept };
  }

  repoUrl(suffix) {
    return `${API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`;
  }

  contentsUrl(path) {
    return this.repoUrl(`/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
  }

  async request(url, init = {}) {
    let res;
    try {
      // no-store: a cached GET would return a stale sha and make every save conflict.
      res = await fetch(url, { cache: "no-store", ...init });
    } catch {
      throw new GitHubError(0, "Network error — check your internet connection.");
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).message || "";
      } catch {
        // body wasn't JSON
      }
      throw new GitHubError(res.status, detail || res.statusText || `HTTP ${res.status}`);
    }
    return res;
  }

  async getFile(path) {
    const ref = `?ref=${encodeURIComponent(this.branch)}`;
    const meta = await (await this.request(this.contentsUrl(path) + ref, { headers: this.headers() })).json();
    let b64 = meta.content;
    if (!b64 && meta.encoding === "none") {
      // Contents API omits bodies over 1 MB; the blobs API serves up to 100 MB.
      const blob = await (await this.request(this.repoUrl(`/git/blobs/${meta.sha}`), { headers: this.headers() })).json();
      b64 = blob.content;
    }
    return { text: b64ToUtf8(b64), sha: meta.sha };
  }

  async putFile(path, text, sha, message) {
    const res = await this.request(this.contentsUrl(path), {
      method: "PUT",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: utf8ToB64(text), sha, branch: this.branch }),
    });
    return (await res.json()).content.sha;
  }

  async listDirNames(path) {
    try {
      const ref = `?ref=${encodeURIComponent(this.branch)}`;
      const items = await (await this.request(this.contentsUrl(path) + ref, { headers: this.headers() })).json();
      return Array.isArray(items) ? items.filter((i) => i.type === "dir").map((i) => i.name) : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  async getRawBlob(path) {
    const ref = `?ref=${encodeURIComponent(this.branch)}`;
    const res = await this.request(this.contentsUrl(path) + ref, {
      headers: this.headers("application/vnd.github.raw+json"),
    });
    return res.blob();
  }
}

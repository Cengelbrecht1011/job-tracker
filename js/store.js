import { toPythonJson } from "./jsonfmt.js";

const RESUMES_DIR = "Resume/applications";
const MAX_ATTEMPTS = 3;

// Every save re-reads jobs.json first and applies the change to the fresh copy, so a
// commit pushed meanwhile (the daily cloud search) is never overwritten. If GitHub
// still reports a sha conflict, the read-apply-write cycle simply runs again.
export class JobStore {
  constructor(repo, path) {
    this.repo = repo;
    this.path = path;
    this.data = null;
    this.resumes = new Set();
    this.queue = Promise.resolve();
  }

  async load() {
    const { text } = await this.repo.getFile(this.path);
    this.data = JSON.parse(text);
    this.resumes = new Set(await this.repo.listDirNames(RESUMES_DIR));
  }

  mutate(mutator, message) {
    const run = async () => {
      for (let attempt = 1; ; attempt++) {
        const { text, sha } = await this.repo.getFile(this.path);
        const data = JSON.parse(text);
        if (!mutator(data)) {
          this.data = data;
          return false;
        }
        try {
          await this.repo.putFile(this.path, toPythonJson(data), sha, message);
          this.data = data;
          return true;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt < MAX_ATTEMPTS) continue;
          throw e;
        }
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  downloadResume(jobId) {
    return this.repo.getRawBlob(`${RESUMES_DIR}/${jobId}/resume.docx`);
  }
}

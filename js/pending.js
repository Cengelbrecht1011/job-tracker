// Jobs whose Apply link was opened but not yet confirmed. Kept in this browser only:
// it's a reminder list, and nothing is committed until the user confirms.
const KEY = "jobtracker.pendingApply";

export class PendingApplies {
  constructor() {
    this.ids = this.read();
  }

  read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  }

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.ids));
    } catch {
      // storage blocked (private mode): the list still works for this page load
    }
  }

  add(id) {
    if (!this.ids.includes(id)) {
      this.ids.push(id);
      this.write();
    }
  }

  remove(ids) {
    this.ids = this.ids.filter((id) => !ids.includes(id));
    this.write();
  }

  keepOnly(validIds) {
    const next = this.ids.filter((id) => validIds.has(id));
    if (next.length !== this.ids.length) {
      this.ids = next;
      this.write();
    }
  }
}

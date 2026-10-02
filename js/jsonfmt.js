// Byte-for-byte equivalent of Python's json.dumps(obj, indent=2, sort_keys=True) + "\n"
// (ensure_ascii on), the format merge_jobs.py writes. Matching it keeps every dashboard
// commit a minimal diff instead of re-escaping the whole file.
function dump(value, depth) {
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const pad = "  ".repeat(depth + 1);
    return `[\n${value.map((v) => pad + dump(v, depth + 1)).join(",\n")}\n${"  ".repeat(depth)}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    if (!keys.length) return "{}";
    const pad = "  ".repeat(depth + 1);
    const body = keys.map((k) => `${pad}${JSON.stringify(k)}: ${dump(value[k], depth + 1)}`);
    return `{\n${body.join(",\n")}\n${"  ".repeat(depth)}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

export function toPythonJson(value) {
  const text = dump(value, 0);
  return text.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) + "\n";
}

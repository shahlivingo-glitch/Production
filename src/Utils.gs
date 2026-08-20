function generateId(prefix) {
  var stamp = new Date().getTime().toString(36);
  var rand = Math.floor(Math.random() * 46656).toString(36);
  return prefix + '-' + stamp + rand;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJsonSafe(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

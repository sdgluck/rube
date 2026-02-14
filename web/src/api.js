export async function getConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to load config");
  return res.json();
}

export async function saveConfig(data) {
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save config");
  return res.json();
}

export async function testPlex(plex_url, plex_token) {
  const res = await fetch("/api/test-plex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plex_url, plex_token }),
  });
  if (!res.ok) throw new Error("Failed to test connection");
  return res.json();
}

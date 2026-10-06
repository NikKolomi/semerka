const HEADER =
  /^(url|urls|site|sites|website|link|адрес|сайт|сайты|ссылка)$/i;

export function normalizeUrl(raw: string): string | null {
  let token = raw.trim().replace(/^\uFEFF/, "");
  token = token.replace(/^["'`«»]+|["'`«»,.;)]+$/g, "").trim();
  if (!token || token.startsWith("#")) return null;
  if (HEADER.test(token)) return null;
  if (/\s/.test(token)) token = token.split(/\s+/)[0] ?? token;
  if (!token) return null;
  if (!/^https?:\/\//i.test(token)) {
    if (token.includes("@") && !token.includes("/")) return null;
    token = `https://${token.replace(/^\/\//, "")}`;
  }
  try {
    const url = new URL(token);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function parseUrlList(text: string): { urls: string[]; skipped: number } {
  const seen = new Set<string>();
  const urls: string[] = [];
  let skipped = 0;
  const cells = text.split(/[\n\r,;]+/);
  for (const cell of cells) {
    const trimmed = cell.trim();
    if (!trimmed || trimmed.startsWith("#") || HEADER.test(trimmed)) continue;
    const url = normalizeUrl(trimmed);
    if (!url) {
      skipped += 1;
      continue;
    }
    const key = url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return { urls, skipped };
}

const CONTACT_HINT = /контакт|contacts?|телефон|обратн/i;

export function pathLooksLikeContact(url: string): boolean {
  try {
    return CONTACT_HINT.test(decodeURIComponent(new URL(url).pathname));
  } catch {
    return false;
  }
}

export function sameSite(a: string, b: string): boolean {
  try {
    const host = (value: string) =>
      new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host(a) === host(b);
  } catch {
    return false;
  }
}

export function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    const text = `${host}${path}`;
    return text.length > 52 ? `${text.slice(0, 50)}…` : text;
  } catch {
    return url;
  }
}

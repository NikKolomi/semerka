import { lookup } from "node:dns/promises";
import { isPrivateHostname } from "./net";
import { extractPhones } from "./phones";
import type { ScanResult } from "./scan-types";
import { normalizeUrl, sameSite } from "./urls";

const TIMEOUT_MS = 9000;
const MAX_BYTES = 1_500_000;
const CONTACT_HINT = /контакт|contacts?|телефон|обратн/i;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function failed(input: string, error: string): ScanResult {
  return {
    input,
    finalUrl: null,
    status: "failed",
    error,
    numbers: [],
    samples: {},
    imageHints: [],
    contactLinks: [],
  };
}

async function assertPublic(hostname: string): Promise<void> {
  if (isPrivateHostname(hostname)) throw new Error("Внутренние адреса запрещены");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Адрес сайта не найден")), 4000);
      }),
    ]);
    if (!records.length) throw new Error("Адрес сайта не найден");
    for (const record of records) {
      if (isPrivateHostname(record.address)) throw new Error("Внутренние адреса запрещены");
    }
  } catch (error) {
    if (error instanceof Error && /запрещены|не найден/.test(error.message)) throw error;
    throw new Error("Адрес сайта не найден");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = MAX_BYTES - total;
      if (value.byteLength > room) {
        chunks.push(value.slice(0, room));
        total = MAX_BYTES;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    /* return whatever arrived */
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decodePage(bytes: Uint8Array, contentType: string | null): string {
  const sniff = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096));
  const fromHeader = contentType?.match(/charset=([^;]+)/i)?.[1]?.trim().replace(/["']/g, "");
  const fromMeta = sniff.match(/charset\s*=\s*["']?\s*([\w-]+)/i)?.[1];
  let charset = (fromHeader || fromMeta || "utf-8").toLowerCase();
  if (charset === "utf8") charset = "utf-8";
  if (charset === "cp1251" || charset === "windows1251") charset = "windows-1251";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function blockReason(html: string): string | null {
  if (html.length > 250_000) return null;
  if (/web page blocked|the url you requested has been blocked|fgd_icon/i.test(html)) {
    return "Сайт не отдал страницу: вместо неё пришла заглушка «доступ заблокирован». Номер с вашего экрана в этот ответ не попал — выделите его на сайте и вставьте ниже. Подойдёт и ссылка вида tel:+7…";
  }
  if (
    /cf-browser-verification|cf-challenge|just a moment|attention required|__cf_chl|qrator|ddos-guard|servicepipe/i.test(
      html,
    )
  ) {
    return "Сайт закрыт проверкой «вы не робот». Откройте его у себя и вставьте номер или текст страницы.";
  }
  return null;
}

function statusError(status: number): string {
  if (status === 401 || status === 403) return "Сайт не пускает автоматический просмотр";
  if (status === 404) return "Страница не найдена";
  if (status === 429) return "Сайт ограничил частые запросы";
  if (status >= 500) return "Сайт временно недоступен";
  return `Сайт ответил ошибкой ${status}`;
}

function contactLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const out: string[] = [];
  const seen = new Set<string>([pageUrl.replace(/\/$/, "")]);
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && out.length < 2) {
    const href = (match[1] || match[2] || "").trim();
    const text = match[3].replace(/<[^>]+>/g, " ");
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (!sameSite(abs.toString(), pageUrl)) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|rar|mp4|mp3)$/i.test(abs.pathname)) continue;
    const haystack = `${abs.pathname} ${text}`;
    if (!CONTACT_HINT.test(haystack)) continue;
    abs.hash = "";
    const next = abs.toString();
    const key = next.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

async function fetchPage(url: string, depth = 0): Promise<{ html: string; finalUrl: string; status: number }> {
  if (depth > 4) throw new Error("Слишком много переадресаций");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Можно открывать только http и https");
  }
  await assertPublic(parsed.hostname);
  let response: Response;
  try {
    response = await fetch(parsed, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ru,en;q=0.8",
        "user-agent": UA,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Сайт не ответил за 9 секунд");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Сайт не ответил за 9 секунд");
    }
    throw new Error("Не удалось открыть сайт");
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Пустая переадресация");
    const next = new URL(location, parsed).toString();
    return fetchPage(next, depth + 1);
  }
  const type = response.headers.get("content-type") ?? "";
  if (type && !/html|xml|text|json/i.test(type)) {
    throw new Error("По этому адресу не страница, а файл");
  }
  const bytes = await readLimited(response);
  return { html: decodePage(bytes, type), finalUrl: parsed.toString(), status: response.status };
}

export async function scanUrl(input: string, followContacts: boolean): Promise<ScanResult> {
  const url = normalizeUrl(input);
  if (!url) return failed(input, "Некорректный адрес");
  try {
    const page = await fetchPage(url);
    const blocked = blockReason(page.html);
    if (blocked) return failed(input, blocked);
    if (page.status < 200 || page.status >= 300) return failed(input, statusError(page.status));
    const found = extractPhones(page.html);
    return {
      input,
      finalUrl: page.finalUrl,
      status: found.numbers.length ? "ok" : "empty",
      error: null,
      numbers: found.numbers,
      samples: found.samples,
      imageHints: found.imageHints,
      contactLinks: followContacts ? contactLinks(page.html, page.finalUrl) : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть сайт";
    return failed(input, message);
  }
}

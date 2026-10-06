const SEP = "[\\s.\\u00B7\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212()/\\\\-]{0,12}";
const PHONE_RE = new RegExp(
  `(?<!\\d)\\+?\\s{0,4}7(?:${SEP}\\d){10}(?!\\d)|(?<!\\d)8(?:${SEP}\\d){10}(?!\\d)`,
  "g",
);

export type Extracted = {
  numbers: string[];
  samples: Record<string, string>;
  imageHints: string[];
};

type Hit = { raw: string; formatted: boolean };

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/"/gi, '"')
    .replace(/&#(\d{1,7});/g, (_, n: string) => fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n: string) => fromCodePoint(parseInt(n, 16)));
}

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function normalizeDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11) return null;
  if (digits[0] === "8") return `7${digits.slice(1)}`;
  if (digits[0] === "7") return digits;
  return null;
}

function isFormatted(raw: string): boolean {
  return /[+\-()/.–—−\s]/.test(raw);
}

function cleanRaw(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 48);
}

function collect(text: string, into: Map<string, Hit>, forceFormat = false) {
  PHONE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PHONE_RE.exec(text))) {
    const raw = match[0];
    const normalized = normalizeDigits(raw);
    if (!normalized) continue;
    if (/(\d)\1{6,}/.test(normalized)) continue;
    const formatted = forceFormat || isFormatted(raw);
    const prev = into.get(normalized);
    if (!prev) into.set(normalized, { raw: cleanRaw(raw), formatted });
    else if (!prev.formatted && formatted) {
      into.set(normalized, { raw: cleanRaw(raw), formatted: true });
    }
  }
}

function harvestTel(html: string): string {
  const re = /\bhref\s*=\s*(?:"\s*tel:([^"]*)"|'\s*tel:([^']*)')/gi;
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw) continue;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    parts.push(decodeEntities(decoded));
  }
  return parts.join("\n");
}

function harvestAttrs(html: string): string {
  const re =
    /\b(?:alt|title|aria-label|placeholder|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const value = match[1] ?? match[2] ?? "";
    if (/\d/.test(value)) parts.push(decodeEntities(value));
  }
  return parts.join("\n");
}

function harvestImageHints(html: string): string[] {
  const hints: string[] = [];
  const re = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const tag = match[0];
    if (!/phone|tel|телефон|номер|call/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    hints.push((src?.[1] ?? src?.[2] ?? "изображение").slice(0, 180));
    if (hints.length >= 8) break;
  }
  return hints;
}

function htmlToText(html: string): string {
  const extras: string[] = [];
  let source = html.replace(/<!--[\s\S]*?-->/g, " ");
  source = source.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs: string, body: string) => {
    const type = /type\s*=\s*["']([^"']+)/i.exec(attrs)?.[1] ?? "";
    if (/ld\+json|json/i.test(type) || /telephone/i.test(body)) extras.push(body);
    return " ";
  });
  source = source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  source = source.replace(/<br\s*\/?>/gi, " ");
  source = source.replace(/<\/?noscript\b[^>]*>/gi, " ");
  source = source.replace(
    /<\/?(?:div|p|li|tr|td|th|h[1-6]|section|article|header|footer|nav|ul|ol|table|thead|tbody|blockquote|address|dt|dd|figcaption|figure|form)\b[^>]*>/gi,
    "\n|\n",
  );
  source = source.replace(/<[^>]+>/g, " ");
  return decodeEntities(`${source}\n${extras.join("\n")}`);
}

export function extractPhones(input: string): Extracted {
  const source = input.length > 1_500_000 ? input.slice(0, 1_500_000) : input;
  const hits = new Map<string, Hit>();
  collect(harvestTel(source), hits, true);
  collect(harvestAttrs(source), hits);
  collect(htmlToText(source), hits);

  let entries = [...hits.entries()];
  if (entries.length > 25) {
    const formatted = entries.filter(([, hit]) => hit.formatted);
    if (formatted.length > 0 && formatted.length < entries.length) entries = formatted;
  }
  entries = entries.slice(0, 200);
  const samples: Record<string, string> = {};
  const numbers: string[] = [];
  for (const [number, hit] of entries) {
    numbers.push(number);
    samples[number] = hit.raw;
  }
  return { numbers, samples, imageHints: harvestImageHints(source) };
}

/** One number typed by hand. Returns null when it is missing, ambiguous, or not 11 digits. */
export function normalizeLoose(input: string): string | null {
  const found = extractPhones(input).numbers;
  return found.length === 1 ? found[0] : null;
}

export function buildConsoleScript(): string {
  return `(function(){var re=${PHONE_RE.toString()};var src=((document.body&&document.body.innerText)||"")+"\\n"+Array.prototype.map.call(document.querySelectorAll('a[href^="tel:"]'),function(a){return a.getAttribute("href")||"";}).join("\\n");var seen={},out=[],m;re.lastIndex=0;while((m=re.exec(src))){var d=m[0].replace(/\\D/g,"");if(d.length!==11)continue;if(d[0]==="8")d="7"+d.slice(1);if(d[0]!=="7"||/(.)\\1{6,}/.test(d)||seen[d])continue;seen[d]=1;out.push(d);}if(!out.length){alert("Номера не найдены. Если номер нарисован картинкой, впишите его в Семерке вручную.");return;}var text=out.join("\\n");if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){alert("Скопировано номеров: "+out.length);},function(){prompt("Скопируйте номера",text);});}else{prompt("Скопируйте номера",text);}})();`;
}

export function buildBookmarklet(): string {
  return `javascript:${buildConsoleScript()}`;
}

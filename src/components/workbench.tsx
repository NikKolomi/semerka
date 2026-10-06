import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, FileSpreadsheet, FileUp } from "lucide-react";
import { btnGhost, btnPrimary, field } from "@/components/classes";
import { SiteCard } from "@/components/site-card";
import { downloadText, fileStamp, toCsv, toXls, type ExportNumber, type ExportSite } from "@/lib/export-table";
import { buildBookmarklet, buildConsoleScript, extractPhones } from "@/lib/phones";
import { scanSite, type ScanResult } from "@/lib/scan.functions";
import type { SiteRow, SiteStatus } from "@/lib/site-types";
import { normalizeUrl, parseUrlList, pathLooksLikeContact } from "@/lib/urls";

const statusLabel: Record<SiteStatus, string> = {
  queued: "в очереди",
  scanning: "проверяется",
  ok: "найдены номера",
  empty: "номеров нет",
  failed: "не открылся",
  manual: "разобрано вручную",
  broken: "не работает",
  stopped: "остановлено",
};

function blankRow(url: string): SiteRow {
  return {
    id: url,
    input: url,
    displayUrl: url,
    status: "queued",
    error: null,
    numbers: [],
    samples: {},
    imageHints: [],
    pages: [],
    note: null,
  };
}

function mergeNumbers(base: string[], extra: string[]): string[] {
  const seen = new Set(base);
  const out = base.slice();
  for (const number of extra) {
    if (seen.has(number)) continue;
    seen.add(number);
    out.push(number);
  }
  return out;
}

export function Workbench() {
  const [tab, setTab] = useState<"list" | "page">("list");
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(true);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [single, setSingle] = useState("");
  const [singleError, setSingleError] = useState<string | null>(null);
  const [pageText, setPageText] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("semerka-draft");
      if (saved) setDraft(saved);
      if (localStorage.getItem("semerka-follow") === "0") setFollow(false);
    } catch {
      /* private mode */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem("semerka-draft", draft);
      localStorage.setItem("semerka-follow", follow ? "1" : "0");
    } catch {
      /* ignore quota */
    }
  }, [draft, follow, ready]);

  const exportRows = useMemo<ExportNumber[]>(() => {
    const map = new Map<string, { sites: string[]; raw: string }>();
    for (const site of sites) {
      if (site.status === "broken" || !site.numbers.length) continue;
      if (site.status === "queued" || site.status === "scanning" || site.status === "stopped") continue;
      for (const number of site.numbers) {
        const current = map.get(number) ?? { sites: [], raw: site.samples[number] ?? "" };
        if (!current.sites.includes(site.displayUrl)) current.sites.push(site.displayUrl);
        if (!current.raw && site.samples[number]) current.raw = site.samples[number];
        map.set(number, current);
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([number, value]) => ({ number, raw: value.raw, sites: value.sites.join(" | ") }));
  }, [sites]);

  const siteRows = useMemo<ExportSite[]>(
    () =>
      sites.map((site) => ({
        url: site.displayUrl,
        status: statusLabel[site.status],
        numbers: site.numbers.join(", "),
        note: [site.error, site.note].filter(Boolean).join(". "),
      })),
    [sites],
  );

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    if (!needle) return exportRows;
    return exportRows.filter((row) => {
      if (digits && row.number.includes(digits)) return true;
      return row.sites.toLowerCase().includes(needle) || row.raw.toLowerCase().includes(needle);
    });
  }, [exportRows, query]);

  const done = sites.filter((site) => site.status !== "queued" && site.status !== "scanning").length;
  const failedCount = sites.filter((site) => site.status === "failed").length;
  const emptyCount = sites.filter((site) => site.status === "empty").length;
  const brokenCount = sites.filter((site) => site.status === "broken").length;

  async function scanOne(url: string, run: number, followContacts: boolean) {
    setSites((prev) =>
      prev.map((site) => (site.id === url ? { ...site, status: "scanning", error: null } : site)),
    );
    let result: ScanResult;
    try {
      result = await scanSite({ data: { url, followContacts } });
    } catch {
      setSites((prev) => {
        if (runRef.current !== run) return prev;
        return prev.map((site) =>
          site.id === url
            ? { ...site, status: "failed", error: "Не удалось связаться с приложением. Попробуйте ещё раз." }
            : site,
        );
      });
      return;
    }
    if (runRef.current !== run) return;

    let numbers = result.numbers.slice();
    const samples = { ...result.samples };
    let hints = result.imageHints.slice(0, 8);
    const pages = [result.finalUrl || url];
    let note: string | null = null;

    if (
      followContacts &&
      result.status !== "failed" &&
      !pathLooksLikeContact(result.finalUrl || url)
    ) {
      for (const link of result.contactLinks) {
        if (runRef.current !== run) return;
        try {
          const extra = await scanSite({ data: { url: link, followContacts: false } });
          if (runRef.current !== run) return;
          if (extra.status === "failed") {
            note = note ?? "Страница контактов не открылась";
            continue;
          }
          numbers = mergeNumbers(numbers, extra.numbers);
          for (const number of extra.numbers) {
            if (!samples[number] && extra.samples[number]) samples[number] = extra.samples[number];
          }
          hints = [...hints, ...extra.imageHints].slice(0, 8);
          pages.push(extra.finalUrl || link);
        } catch {
          note = note ?? "Страница контактов не открылась";
        }
      }
    }

    const status: SiteStatus = result.status === "failed" ? "failed" : numbers.length ? "ok" : "empty";
    setSites((prev) => {
      if (runRef.current !== run) return prev;
      return prev.map((site) =>
        site.id === url
          ? {
              ...site,
              status,
              error: result.error,
              numbers,
              samples,
              imageHints: hints,
              pages,
              note,
              displayUrl: result.finalUrl || url,
            }
          : site,
      );
    });
  }

  async function startScan() {
    const parsed = parseUrlList(draft);
    if (!parsed.urls.length) {
      setFormError("Добавьте хотя бы один адрес сайта");
      return;
    }
    const urls = parsed.urls.slice(0, 40);
    const notes: string[] = [];
    if (parsed.urls.length > 40) notes.push("За один проход беру первые 40 адресов");
    if (parsed.skipped) notes.push("Строки, не похожие на адрес, пропущены");
    setFormError(notes.length ? notes.join(". ") : null);
    const run = ++runRef.current;
    setSites(urls.map(blankRow));
    setScanning(true);
    const queue = urls.slice();
    const worker = async () => {
      while (queue.length && runRef.current === run) {
        const url = queue.shift();
        if (!url) return;
        await scanOne(url, run, follow);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, urls.length) }, () => worker()));
    } finally {
      if (runRef.current === run) setScanning(false);
    }
  }

  function stopScan() {
    runRef.current += 1;
    setScanning(false);
    setSites((prev) =>
      prev.map((site) =>
        site.status === "queued" || site.status === "scanning"
          ? { ...site, status: "stopped", error: null }
          : site,
      ),
    );
  }

  async function retry(id: string) {
    if (!normalizeUrl(id)) return;
    const run = runRef.current;
    setScanning(true);
    try {
      await scanOne(id, run, follow);
    } finally {
      if (runRef.current === run) setScanning(false);
    }
  }

  async function scanSingle() {
    const url = normalizeUrl(single);
    if (!url) {
      setSingleError("Некорректный адрес");
      return;
    }
    setSingleError(null);
    setSites((prev) => (prev.some((site) => site.id === url) ? prev : [...prev, blankRow(url)]));
    const run = runRef.current;
    setScanning(true);
    try {
      await scanOne(url, run, follow);
    } finally {
      if (runRef.current === run) setScanning(false);
    }
  }

  function parsePastedPage() {
    const text = pageText.trim();
    if (!text) {
      setPageError("Вставьте текст или код страницы");
      return;
    }
    const found = extractPhones(text);
    const row: SiteRow = {
      id: `paste-${Date.now()}`,
      input: "Вставленный текст",
      displayUrl: "Вставленный текст",
      status: found.numbers.length ? "manual" : "empty",
      error: null,
      numbers: found.numbers,
      samples: found.samples,
      imageHints: found.imageHints,
      pages: [],
      note: found.numbers.length
        ? "Разобрано из вставленного текста"
        : "Во вставленном тексте номеров нет",
    };
    setSites((prev) => [row, ...prev]);
    setPageText("");
    setPageError(found.numbers.length ? null : "Во вставленном тексте номеров нет");
  }

  function markBroken(id: string, broken: boolean) {
    setSites((prev) =>
      prev.map((site) => {
        if (site.id !== id) return site;
        if (broken) return { ...site, status: "broken", error: "Отмечен как неработающий" };
        return {
          ...site,
          status: site.numbers.length ? "manual" : "failed",
          error: site.numbers.length ? null : "Снова в списке. Можно повторить проверку.",
        };
      }),
    );
  }

  function applyPaste(id: string, text: string) {
    const found = extractPhones(text);
    setSites((prev) =>
      prev.map((site) => {
        if (site.id !== id) return site;
        const numbers = mergeNumbers(site.numbers, found.numbers);
        return {
          ...site,
          numbers,
          samples: { ...site.samples, ...found.samples },
          imageHints: [...site.imageHints, ...found.imageHints].slice(0, 8),
          status: numbers.length ? (site.status === "ok" ? "ok" : "manual") : "empty",
          error: null,
          note: numbers.length ? "Разобрано из вставленного текста" : "Во вставленном тексте номеров нет",
        };
      }),
    );
  }

  function addNumber(id: string, number: string) {
    setSites((prev) =>
      prev.map((site) => {
        if (site.id !== id) return site;
        const numbers = site.numbers.includes(number) ? site.numbers : [...site.numbers, number];
        const revive =
          site.status === "broken" ||
          site.status === "failed" ||
          site.status === "empty" ||
          site.status === "stopped" ||
          site.status === "queued";
        return {
          ...site,
          numbers,
          samples: { ...site.samples, [number]: site.samples[number] ?? number },
          status: revive ? "manual" : site.status,
          error: null,
          note: "Номер добавлен вручную",
        };
      }),
    );
  }

  function readFile(file: File) {
    if (file.size > 2_000_000) {
      setFormError("Файл больше 2 МБ");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setDraft((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
      setFormError(null);
    };
    reader.readAsText(file);
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 2000);
    } catch {
      setFormError("Браузер не дал скопировать. Выделите список и скопируйте его сами.");
    }
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary font-mono text-xl font-medium text-primary-fg">
            7
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Семерка</h1>
            <p className="text-sm text-muted">Телефоны с сайтов списком в виде 7XXXXXXXXXX</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-3">
        <section className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-soft p-1" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "list"}
                className={`h-11 rounded-lg px-2 text-sm font-medium ${tab === "list" ? "bg-surface text-ink" : "text-muted"}`}
                onClick={() => setTab("list")}
              >
                Список сайтов
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "page"}
                className={`h-11 rounded-lg px-2 text-sm font-medium ${tab === "page" ? "bg-surface text-ink" : "text-muted"}`}
                onClick={() => setTab("page")}
              >
                Открытая страница
              </button>
            </div>

            {tab === "list" ? (
              <div className="mt-4 grid gap-3">
                <p className="text-sm text-muted">
                  Адреса по одному в строке. Страницы скачиваются в фоне и здесь не открываются:
                  отдельный сторонний сервис не нужен, это делает само приложение.
                </p>
                <label className="grid gap-2 text-sm font-medium" htmlFor="sites">
                  Сайты
                  <textarea
                    id="sites"
                    className={`${field} min-h-48 font-mono`}
                    value={draft}
                    placeholder={"example.ru\nhttps://shop.ru/contacts"}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !scanning) {
                        event.preventDefault();
                        void startScan();
                      }
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const file = event.dataTransfer.files?.[0];
                      if (file) readFile(file);
                    }}
                  />
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={follow}
                    onChange={(event) => setFollow(event.target.checked)}
                  />
                  Также проверить страницы контактов на том же сайте
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {scanning ? (
                    <button type="button" className={btnGhost} onClick={stopScan}>
                      Остановить
                    </button>
                  ) : (
                    <button type="button" className={btnPrimary} onClick={() => void startScan()}>
                      Собрать номера
                    </button>
                  )}
                  <label className={btnGhost}>
                    <FileUp className="size-4" aria-hidden />
                    Файл
                    <input
                      type="file"
                      accept=".txt,.csv,.tsv,text/plain,text/csv"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) readFile(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {formError ? <p className="text-sm text-danger">{formError}</p> : null}
                {scanning ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span>Проверяю сайты</span>
                      <span className="font-mono tabular-nums">
                        {done}/{sites.length}
                      </span>
                    </div>
                    <progress value={done} max={Math.max(sites.length, 1)} aria-label="Ход проверки" />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 grid gap-4">
                <p className="text-sm text-muted">
                  Чужую вкладку приложение прочитать не может. Вставьте адрес — страница скачается в
                  фоне. Либо скопируйте текст открытой страницы, либо запустите на ней скрипт.
                </p>
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void scanSingle();
                  }}
                >
                  <label className="grid gap-2 text-sm font-medium" htmlFor="one-url">
                    Адрес открытой страницы
                    <input
                      id="one-url"
                      className={field}
                      value={single}
                      onChange={(event) => setSingle(event.target.value)}
                      placeholder="https://example.ru/contacts"
                      inputMode="url"
                    />
                  </label>
                  <button type="submit" className={btnPrimary} disabled={scanning}>
                    Скачать номера в фоне
                  </button>
                  {singleError ? <p className="text-sm text-danger">{singleError}</p> : null}
                </form>
                <div className="grid gap-2">
                  <label className="grid gap-2 text-sm font-medium" htmlFor="page-text">
                    Текст или код этой страницы
                    <textarea
                      id="page-text"
                      className={`${field} min-h-32`}
                      value={pageText}
                      onChange={(event) => setPageText(event.target.value)}
                      placeholder="Вставьте скопированный текст или исходный код"
                    />
                  </label>
                  <button type="button" className={btnGhost} onClick={parsePastedPage}>
                    Разобрать вставленное
                  </button>
                  {pageError ? <p className="text-sm text-danger">{pageError}</p> : null}
                </div>
                <div className="grid gap-2 border-t border-line pt-4">
                  <p className="text-sm font-medium">Скрипт для уже открытой вкладки</p>
                  <p className="text-sm text-muted">
                    На сайте нажмите F12, откройте консоль, вставьте код и нажмите Enter. Номера
                    скопируются — их можно вставить сюда. Номер, нарисованный только картинкой, скрипт
                    не увидит.
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => void copyText(buildConsoleScript(), "script")}
                    >
                      {copied === "script" ? "Скрипт скопирован" : "Скопировать скрипт для консоли"}
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => void copyText(buildBookmarklet(), "bookmark")}
                    >
                      {copied === "bookmark" ? "Закладка скопирована" : "Скопировать закладку"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <p className="mt-3 px-1 text-sm text-muted">
            Берутся номера из 11 цифр, которые начинаются на +7, 7 или 8. Скобки, пробелы и тире
            убираются, 8 в начале заменяется на 7.
          </p>
        </section>

        <section className="grid min-w-0 gap-4 lg:col-span-2">
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Общий список</h2>
                <p className="text-sm text-muted">Одинаковые номера с разных сайтов склеены в одну строку.</p>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:w-auto">
                <button
                  type="button"
                  className={btnGhost}
                  disabled={!exportRows.length}
                  onClick={() => void copyText(exportRows.map((row) => row.number).join("\n"), "numbers")}
                >
                  <Copy className="size-4" aria-hidden />
                  {copied === "numbers" ? "Готово" : "Копия"}
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={!exportRows.length}
                  onClick={() =>
                    downloadText(`nomera-${fileStamp()}.csv`, toCsv(exportRows), "text/csv;charset=utf-8")
                  }
                >
                  <FileSpreadsheet className="size-4" aria-hidden />
                  CSV
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={!sites.length}
                  onClick={() =>
                    downloadText(
                      `nomera-${fileStamp()}.xls`,
                      toXls(exportRows, siteRows),
                      "application/vnd.ms-excel",
                    )
                  }
                >
                  <FileSpreadsheet className="size-4" aria-hidden />
                  XLS
                </button>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Номера" value={exportRows.length} />
              <Stat label="Сайты" value={sites.length} />
              <Stat label="Не открылись" value={failedCount} danger={failedCount > 0} />
              <Stat label="Пустые / откл." value={emptyCount + brokenCount} />
            </dl>

            {exportRows.length > 0 ? (
              <label className="mt-4 grid gap-2 text-sm font-medium" htmlFor="filter">
                Найти в списке
                <input
                  id="filter"
                  className={field}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Номер или сайт"
                />
              </label>
            ) : null}

            {visibleRows.length > 0 ? (
              <ul className="mt-4 max-h-96 overflow-y-auto border-t border-line">
                {visibleRows.map((row) => (
                  <li key={row.number} className="border-b border-line py-3">
                    <p className="font-mono text-base">{row.number}</p>
                    <p className="mt-1 break-all text-sm text-muted" title={row.raw}>
                      {row.sites}
                    </p>
                  </li>
                ))}
              </ul>
            ) : sites.length > 0 ? (
              <p className="mt-4 text-sm text-muted">
                В общем списке пока пусто. Если сайт не открылся, вставьте код страницы или отметьте, что он не
                работает.
              </p>
            ) : (
              <div className="mt-4 rounded-lg bg-soft px-4 py-5">
                <h3 className="font-semibold">Как получить список</h3>
                <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm text-muted">
                  <li>Вставьте адреса сайтов или откройте вкладку «Открытая страница».</li>
                  <li>Номера соберутся сами. Сайт, который не пустил, можно добить текстом страницы.</li>
                  <li>Скачайте CSV для таблиц или XLS с двумя листами: номера и отчёт по сайтам.</li>
                </ol>
              </div>
            )}
          </div>

          {sites.length > 0 ? (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">По сайтам</h2>
                <button
                  type="button"
                  className="inline-flex h-11 items-center px-2 text-sm font-medium text-muted"
                  onClick={() => setSites([])}
                  disabled={scanning}
                >
                  Очистить
                </button>
              </div>
              {sites.map((site) => (
                <SiteCard
                  key={site.id}
                  row={site}
                  busy={scanning}
                  onRetry={(id) => void retry(id)}
                  onBroken={markBroken}
                  onPaste={applyPaste}
                  onAdd={addNumber}
                />
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`font-mono text-xl tabular-nums ${danger ? "text-danger" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

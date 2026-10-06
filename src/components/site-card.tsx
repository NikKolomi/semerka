import { useEffect, useState } from "react";
import { Ban, ExternalLink, RotateCw } from "lucide-react";
import { btnDanger, btnGhost, field } from "@/components/classes";
import { normalizeLoose } from "@/lib/phones";
import type { SiteRow, SiteStatus } from "@/lib/site-types";
import { normalizeUrl, shortUrl } from "@/lib/urls";

const statusText: Record<SiteStatus, string> = {
  queued: "В очереди",
  scanning: "Читаю страницу…",
  ok: "Номера найдены",
  empty: "В коде номеров нет",
  failed: "Не открылся",
  manual: "Добавлено вручную",
  broken: "Не работает",
  stopped: "Остановлено",
};

function barClass(status: SiteStatus): string {
  if (status === "ok" || status === "manual") return "bg-primary";
  if (status === "failed") return "bg-danger";
  if (status === "scanning") return "bg-primary";
  return "bg-line";
}

export function SiteCard({
  row,
  busy,
  onRetry,
  onBroken,
  onPaste,
  onAdd,
}: {
  row: SiteRow;
  busy: boolean;
  onRetry: (id: string) => void;
  onBroken: (id: string, broken: boolean) => void;
  onPaste: (id: string, text: string) => void;
  onAdd: (id: string, number: string) => void;
}) {
  const [assist, setAssist] = useState(false);
  const [source, setSource] = useState("");
  const [hand, setHand] = useState("");
  const [handError, setHandError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const canFetch = normalizeUrl(row.input) !== null;
  const shown = expanded ? row.numbers : row.numbers.slice(0, 6);
  const needsHelp = row.status === "failed" || row.status === "empty" || row.status === "stopped";

  useEffect(() => {
    if (row.status === "failed") setAssist(true);
  }, [row.status]);

  return (
    <article className="flex overflow-hidden rounded-lg border border-line bg-surface">
      <span className={`w-1 shrink-0 ${barClass(row.status)}`} aria-hidden />
      <div className="min-w-0 flex-1 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="min-w-0 break-all text-sm font-semibold" title={row.displayUrl}>
            {shortUrl(row.displayUrl)}
          </h3>
          <p className="text-sm text-muted">{statusText[row.status]}</p>
        </div>
        {row.error ? <p className="mt-2 text-sm text-danger">{row.error}</p> : null}
        {row.note ? <p className="mt-2 text-sm text-muted">{row.note}</p> : null}
        {row.pages.length > 1 ? (
          <p className="mt-2 text-sm text-muted">
            Проверены страницы: {row.pages.map((page) => shortUrl(page)).join(", ")}
          </p>
        ) : null}
        {row.imageHints.length > 0 && row.numbers.length === 0 ? (
          <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            Похоже, номер вставлен картинкой. Его нельзя прочитать из кода — впишите цифры вручную,
            если видите их на экране.
          </p>
        ) : null}
        {row.numbers.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {shown.map((number) => (
              <li
                key={number}
                className="rounded-lg bg-soft px-2 py-1 font-mono text-sm text-ink"
                title={row.samples[number] || number}
              >
                {number}
              </li>
            ))}
          </ul>
        ) : null}
        {row.numbers.length > 6 ? (
          <button
            type="button"
            className="mt-2 inline-flex h-11 items-center text-sm font-medium text-primary"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Свернуть" : `Показать все ${row.numbers.length}`}
          </button>
        ) : null}

        {needsHelp ? (
          <p className="mt-3 text-sm text-muted">
            {row.status === "stopped"
              ? "Проверка остановлена. Можно запустить её снова."
              : row.status === "empty"
                ? "Если номер виден только у вас в браузере, выделите его на сайте и вставьте ниже."
                : row.error
                  ? "Поле для текста этой страницы открыто ниже."
                  : "Откройте сайт у себя и вставьте код страницы, либо отметьте, что сайт не работает."}
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {canFetch ? (
            <button
              type="button"
              className={btnGhost}
              disabled={busy}
              onClick={() => onRetry(row.id)}
            >
              <RotateCw className="size-4" aria-hidden />
              Повторить
            </button>
          ) : null}
          {canFetch ? (
            <a className={btnGhost} href={row.input} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" aria-hidden />
              Открыть у себя
            </a>
          ) : null}
          {row.status === "broken" ? (
            <button type="button" className={btnGhost} onClick={() => onBroken(row.id, false)}>
              Снять отметку
            </button>
          ) : (
            <button type="button" className={btnDanger} onClick={() => onBroken(row.id, true)}>
              <Ban className="size-4" aria-hidden />
              Не работает
            </button>
          )}
        </div>

        <button
          type="button"
          className="mt-3 inline-flex h-11 items-center text-sm font-medium text-primary"
          onClick={() => setAssist((value) => !value)}
        >
          {assist ? "Скрыть вставку" : "Вставить код или текст страницы"}
        </button>
        {assist ? (
          <div className="mt-2 grid gap-2">
            <label className="sr-only" htmlFor={`paste-${row.id}`}>
              Код или текст страницы
            </label>
            <textarea
              id={`paste-${row.id}`}
              className={`${field} min-h-32`}
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="Вставьте сюда текст со страницы или её исходный код"
            />
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                onPaste(row.id, source);
                setSource("");
                setAssist(false);
              }}
            >
              Разобрать вставленное
            </button>
          </div>
        ) : null}

        <form
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const number = normalizeLoose(hand);
            if (!number) {
              setHandError("Нужен один номер из 11 цифр, начиная с +7, 7 или 8");
              return;
            }
            setHandError(null);
            onAdd(row.id, number);
            setHand("");
          }}
        >
          <label className="sr-only" htmlFor={`hand-${row.id}`}>
            Добавить номер вручную
          </label>
          <input
            id={`hand-${row.id}`}
            className={field}
            value={hand}
            onChange={(event) => setHand(event.target.value)}
            placeholder="+7 (999) 123-45-67"
            inputMode="tel"
          />
          <button type="submit" className={btnGhost}>
            Добавить номер
          </button>
        </form>
        {handError ? <p className="mt-2 text-sm text-danger">{handError}</p> : null}
      </div>
    </article>
  );
}

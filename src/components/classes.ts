export const btn =
  "inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50";

export const btnPrimary = `${btn} bg-primary text-primary-fg hover:opacity-90`;
export const btnGhost = `${btn} border border-line bg-surface text-ink hover:bg-soft`;
export const btnDanger = `${btn} border border-line bg-surface text-danger hover:bg-danger-soft`;

export const field =
  "w-full rounded-lg border border-line bg-surface px-3 py-3 text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

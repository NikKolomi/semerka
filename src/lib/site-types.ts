export type SiteStatus =
  | "queued"
  | "scanning"
  | "ok"
  | "empty"
  | "failed"
  | "manual"
  | "broken"
  | "stopped";

export type SiteRow = {
  id: string;
  input: string;
  displayUrl: string;
  status: SiteStatus;
  error: string | null;
  numbers: string[];
  samples: Record<string, string>;
  imageHints: string[];
  pages: string[];
  note: string | null;
};

export type ScanResult = {
  input: string;
  finalUrl: string | null;
  status: "ok" | "empty" | "failed";
  error: string | null;
  numbers: string[];
  samples: Record<string, string>;
  imageHints: string[];
  contactLinks: string[];
};

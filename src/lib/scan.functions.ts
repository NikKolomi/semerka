import { createServerFn } from "@tanstack/react-start";
import type { ScanResult } from "./scan-types";

export type { ScanResult };

export const scanSite = createServerFn({ method: "POST" })
  .validator((input: { url: string; followContacts?: boolean }) => {
    if (!input || typeof input.url !== "string") throw new Error("Некорректный адрес");
    const url = input.url.trim();
    if (!url || url.length > 2000) throw new Error("Некорректный адрес");
    return { url, followContacts: input.followContacts !== false };
  })
  .handler(async ({ data }): Promise<ScanResult> => {
    const { scanUrl } = await import("./scan.server");
    return scanUrl(data.url, data.followContacts);
  });

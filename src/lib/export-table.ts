export type ExportNumber = { number: string; raw: string; sites: string };
export type ExportSite = { url: string; status: string; numbers: string; note: string };

function csvCell(value: string): string {
  if (/[;"\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(rows: ExportNumber[]): string {
  const lines = [
    "Номер;Как на сайте;Где найден",
    ...rows.map((row) => [row.number, row.raw, row.sites].map(csvCell).join(";")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function xml(value: string): string {
  const amp = "\u0026amp;";
  const lt = "\u0026lt;";
  const gt = "\u0026gt;";
  const quot = "\u0026quot;";
  return value
    .replace(/&/g, amp)
    .replace(/</g, lt)
    .replace(/>/g, gt)
    .replace(/"/g, quot);
}

function sheet(name: string, header: string[], rows: string[][]): string {
  const head = `<Row>${header
    .map((cell) => `<Cell><Data ss:Type="String">${xml(cell)}</Data></Cell>`)
    .join("")}</Row>`;
  const body = rows
    .map(
      (row) =>
        `<Row>${row
          .map((cell) => `<Cell><Data ss:Type="String">${xml(cell)}</Data></Cell>`)
          .join("")}</Row>`,
    )
    .join("");
  return `<Worksheet ss:Name="${xml(name)}"><Table>${head}${body}</Table></Worksheet>`;
}

export function toXls(numbers: ExportNumber[], sites: ExportSite[]): string {
  const numberRows = numbers.map((row) => [row.number, row.raw, row.sites]);
  const siteRows = sites.map((row) => [row.url, row.status, row.numbers, row.note]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${sheet("Номера", ["Номер", "Как на сайте", "Где найден"], numberRows)}
${sheet("Сайты", ["Сайт", "Статус", "Номера", "Примечание"], siteRows)}
</Workbook>`;
}

export function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const link = document.createElement("a");
  const href = URL.createObjectURL(blob);
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export function fileStamp(): string {
  const date = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

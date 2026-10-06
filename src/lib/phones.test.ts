import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateHostname } from "./net.ts";
import { extractPhones, normalizeLoose } from "./phones.ts";
import { parseUrlList } from "./urls.ts";

test("normalizes +7, 8 and bare 7 to 7XXXXXXXXXX", () => {
  const found = extractPhones(`
    +7 (999) 123-45-67
    8 (999) 123-45-67
    79991234567
    8-800-555-35-35
  `);
  assert.deepEqual(found.numbers.sort(), ["78005553535", "79991234567"]);
});

test("reads tel links, json-ld and split markup", () => {
  const html = `
    <a href="tel:+7%20(495)%20111-22-33">позвонить</a>
    <script type="application/ld+json">{"telephone":"8 (812) 333-44-55"}</script>
    <span>+7</span><span> (903) 000-11-22</span>
    <img src="/tel.png" alt="телефон">
  `;
  const found = extractPhones(html);
  assert.ok(found.numbers.includes("74951112233"));
  assert.ok(found.numbers.includes("78123334455"));
  assert.ok(found.numbers.includes("79030001122"));
  assert.equal(found.imageHints.length, 1);
});

test("does not join numbers across table cells", () => {
  const html = "<table><tr><td>8</td><td>1234567890</td></tr></table>";
  assert.deepEqual(extractPhones(html).numbers, []);
});

test("decodes nbsp and ignores short or placeholder numbers", () => {
  const found = extractPhones("+7&nbsp;(999)&nbsp;222-33-44 и 70000000000 и 9991234567");
  assert.deepEqual(found.numbers, ["79992223344"]);
});

test("normalizeLoose accepts one number only", () => {
  assert.equal(normalizeLoose("8 (999) 123-45-67"), "79991234567");
  assert.equal(normalizeLoose("два 89991234567 и 89997654321"), null);
  assert.equal(normalizeLoose("123"), null);
});

test("parseUrlList adds https and skips junk", () => {
  const parsed = parseUrlList("example.ru\nhttps://shop.ru/contacts, not a url\n# comment\nurl");
  assert.deepEqual(parsed.urls, ["https://example.ru/", "https://shop.ru/contacts"]);
  assert.equal(parsed.skipped, 1);
});

test("reads a dealer header number with city code and tel link", () => {
  const found = extractPhones(
    'Продажи <a href="tel:+7 (384) 320 00 76">+7 (384) 320 00 76</a>',
  );
  assert.deepEqual(found.numbers, ["73843200076"]);
});

test("blocks private hosts", () => {
  assert.equal(isPrivateHostname("127.0.0.1"), true);
  assert.equal(isPrivateHostname("10.1.2.3"), true);
  assert.equal(isPrivateHostname("192.168.0.5"), true);
  assert.equal(isPrivateHostname("localhost"), true);
  assert.equal(isPrivateHostname("8.8.8.8"), false);
  assert.equal(isPrivateHostname("example.ru"), false);
});

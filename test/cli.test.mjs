import test from "node:test";
import assert from "node:assert/strict";
import { find, renderFind, connect, renderConnect, verify, renderVerify, apiBuyLink, isConnected, splitDomain, parseArgs } from "../bin/adddomain.mjs";

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("splitDomain strips scheme, www and path", () => {
  assert.deepEqual(splitDomain("https://www.LunaBakery.com/menu"), { label: "lunabakery", tld: "com" });
  assert.deepEqual(splitDomain("luna bakery"), { label: "luna-bakery", tld: "" });
});

test("apiBuyLink accepts only the selected domain on the store review route", () => {
  assert.equal(apiBuyLink("https://www.adddomain.net/buy?domain=luna.co&src=cli", "luna.co"), "https://www.adddomain.net/buy?domain=luna.co&src=cli");
  assert.equal(apiBuyLink("/buy?domain=luna.co"), null);
  assert.equal(apiBuyLink("https://example.org/buy?domain=luna.co", "luna.co"), null);
  assert.equal(apiBuyLink("https://www.adddomain.net/buy?domain=other.co", "luna.co"), null);
  assert.equal(apiBuyLink(""), null);
  assert.equal(apiBuyLink(null), null);
});

test("find uses the store buy link and never invents a registrar URL", async () => {
  const buy = "https://www.adddomain.net/buy?domain=luna.co&src=cli";
  const f = async (url) => {
    assert.match(url, /^https:\/\/www\.adddomain\.net\/api\/check\?name=luna&src=cli&tlds=com%2Cco/);
    return json({ results: [
      { domain: "luna.com", status: "registered", price: { currency: "USD", first_year: 11.28, renewal: 18.48, checked_on: "2026-10-14" }, buy: null },
      { domain: "luna.co", status: "available", price: { currency: "USD", first_year: 9.98, renewal: 33.98, checked_on: "2026-10-14" }, buy },
    ] });
  };
  const out = await find("luna", { tlds: ["com", "co"], f });
  assert.equal(out.results[0].buy, null);
  assert.equal(out.results[1].buy, buy);
  const text = renderFind(out);
  assert.match(text, /TAKEN  luna\.com/);
  assert.match(text, /luna\.co is free: USD 9\.98 first year, then USD 33\.98\/year \(listed 2026-10-14\)/);
  assert.match(text, /You buy it yourself via Add Domain: https:\/\/www\.adddomain\.net\/buy\?domain=luna\.co&src=cli/);
  assert.doesNotMatch(text, /namecheap\.pxf\.io/);
  assert.doesNotMatch(text, /luna\.com is free/);
});

test("find does not fabricate a buy link or price when the API omits them", async () => {
  const f = async () => json({ results: [
    { domain: "plain.com", status: "available" },
    { domain: "plain.co", status: "unknown", price: { currency: "USD", first_year: 1, renewal: 2, checked_on: "2026-10-14" }, buy: "https://www.adddomain.net/buy?domain=plain.co&src=cli" },
  ] });
  const out = await find("plain", { tlds: ["com", "co"], f });
  assert.equal(out.results[0].status, "available");
  assert.equal(out.results[0].price, null);
  assert.equal(out.results[0].buy, null);
  assert.equal(out.results[1].status, "unknown");
  assert.equal(out.results[1].buy, "https://www.adddomain.net/buy?domain=plain.co&src=cli");
  const text = renderFind(out);
  assert.match(text, /FREE\s+plain\.com/);
  assert.match(text, /CHECK\s+plain\.co/);
  assert.doesNotMatch(text, /plain\.co is free/);
  assert.doesNotMatch(text, /USD/);
  assert.match(text, /No first-party buy link was returned/);
  assert.doesNotMatch(text, /namecheap|pxf\.io/i);
});

test("find falls back to the registry and invents no price or buy link when the store is down", async () => {
  const f = async (url) => {
    if (url.startsWith("https://www.adddomain.net")) throw new Error("fetch failed");
    if (url === "https://data.iana.org/rdap/dns.json") return json({ services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] });
    if (url === "https://rdap.verisign.com/com/v1/domain/warmcrumb.com") return json({}, 404);
    throw new Error("unexpected " + url);
  };
  const out = await find("warmcrumb.com", { f });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].status, "available");
  assert.equal(out.results[0].price, null);
  assert.equal(out.results[0].buy, null);
  const text = renderFind(out);
  assert.doesNotMatch(text, /USD/);
  assert.doesNotMatch(text, /namecheap|pxf\.io/i);
  assert.match(text, /No first-party buy link was returned/);
});

test("connect prints Vercel's documented records with Namecheap host fields", () => {
  const text = renderConnect(connect("lunabakery.com", "vercel"));
  assert.match(text, /A     host @ +value 76\.76\.21\.21/);
  assert.match(text, /CNAME host www +value cname\.vercel-dns\.com/);
  assert.match(text, /vercel domains add lunabakery\.com/);
});

test("connect refuses an unknown host instead of guessing", () => {
  assert.throws(() => connect("luna.com", "wix"), /Unknown --host/);
});

test("verify marks a missing record and unfinished HTTPS", async () => {
  const f = async (url) => {
    if (url.includes("type=A")) return json({ Answer: [{ data: "76.76.21.21" }] });
    if (url.includes("type=CNAME")) return json({ Answer: [{ data: "parkingpage.namecheap.com." }] });
    throw new Error("connect ECONNREFUSED");
  };
  const v = await verify("luna.com", "vercel", undefined, f);
  assert.equal(v.checks[0].found, true);
  assert.equal(v.checks[1].found, false);
  assert.deepEqual(v.checks[1].seen, ["parkingpage.namecheap.com"]);
  assert.equal(v.https, "no answer yet");
  assert.equal(v.connected, false);
  assert.match(renderVerify(v), /Not finished/);
});

test("verify does not report Connected when a required check is inconclusive", async () => {
  const f = async (url) => {
    if (url.includes("type=A")) return json({ Answer: [{ data: "76.76.21.21" }] });
    if (url.includes("type=CNAME")) throw new Error("DoH timeout");
    if (String(url).startsWith("https://www.luna.com")) return { status: 200 };
    throw new Error("unexpected " + url);
  };
  const v = await verify("luna.com", "vercel", undefined, f);
  assert.equal(v.checks[0].found, true);
  assert.equal(v.checks[1].found, null);
  assert.equal(v.https, 200);
  assert.equal(v.connected, false);
  assert.equal(isConnected(v), false);
  assert.match(renderVerify(v), /Not finished/);
  assert.doesNotMatch(renderVerify(v), /^Connected/m);
});

test("verify does not report Connected when host-only values stay unresolved", async () => {
  const f = async (url) => {
    if (url.includes("type=A")) return json({ Answer: [{ data: "185.158.133.1" }] });
    if (String(url).startsWith("https://www.luna.com")) return { status: 200 };
    throw new Error("unexpected " + url);
  };
  const v = await verify("luna.com", "lovable", "185.158.133.1", f);
  assert.ok(v.checks.some((check) => check.found === null));
  assert.equal(v.https, 200);
  assert.equal(v.connected, false);
  assert.match(renderVerify(v), /Not finished/);
});

test("verify reports Connected only when every required check matched", async () => {
  const f = async (url) => {
    if (url.includes("type=A")) return json({ Answer: [{ data: "76.76.21.21" }] });
    if (url.includes("type=CNAME")) return json({ Answer: [{ data: "cname.vercel-dns.com." }] });
    if (String(url).startsWith("https://www.luna.com")) return { status: 200 };
    throw new Error("unexpected " + url);
  };
  const v = await verify("luna.com", "vercel", undefined, f);
  assert.equal(v.connected, true);
  assert.ok(v.checks.every((check) => check.found === true));
  assert.match(renderVerify(v), /DNS and HTTPS responded/);
});

test("parseArgs reads flags with and without =", () => {
  assert.deepEqual(parseArgs(["connect", "luna.com", "--host", "netlify", "--target=luna.netlify.app", "--json"]),
    { _: ["connect", "luna.com"], flags: { host: "netlify", target: "luna.netlify.app", json: true } });
});

import {writeFile} from "node:fs/promises";

const catalog = "https://hololive.hololivepro.com/events/";
const cards = new Map();

function text(markup) {
  const entities = {amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " "};
  return markup.replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== "#") return entities[code] ?? match;
    const hex = code[1].toLowerCase() === "x";
    const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    return value <= 0x10ffff ? String.fromCodePoint(value) : match;
  }).replace(/\s+/g, " ").trim();
}

function dates(label) {
  const days = [...label.matchAll(/(\d{4})\.(\d{1,2})\.(\d{1,2})/g)].map(([, year, month, day]) =>
    year + "-" + month.padStart(2, "0") + "-" + day.padStart(2, "0"));
  const start = days[0];
  const end = days.at(-1);
  return { start, end: days.length === 1 && /[-–〜～]\s*$/.test(label) ? null : end };
}

for (let page = 1; ; page++) {
  const url = new URL(catalog);
  if (page > 1) url.searchParams.set("paged", page);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Official EVENTS HTTP " + response.status);
  const markup = await response.text();
  const links = /<a\b[^>]*\shref=["']((?:https:\/\/hololive\.hololivepro\.com)?\/events\/[\w-]+\/)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let dateCards = 0;
  for (const [, link, card] of markup.matchAll(links)) {
    const heading = card.match(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i)?.[1];
    const date = heading?.match(/<span\b[^>]*class=["']date(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/span>/i);
    if (!date) continue;
    dateCards++;
    const dateLabel = text(date[1]);
    if (dateLabel.includes("運営中")) continue;
    const {start, end} = dates(dateLabel);
    const title = text(heading.replace(date[0], ""));
    if (!start || !title) continue;
    const src = card.match(/<img\b[^>]*\ssrc=["']([^"']+)["']/i)?.[1];
    const image = src ? new URL(src.replaceAll("&amp;", "&"), catalog) : null;
    const href = new URL(link, catalog).href;
    cards.set(href, { title, dateLabel, start, end, image: image?.protocol === "https:" ? image.href : "", href });
  }
  if (!dateCards) throw new Error("No date cards found on EVENTS page " + page);
  if (!/<a\b[^>]*class=["'][^"']*\bnext\s+page-numbers\b/i.test(markup)) break;
  if (page >= 20) throw new Error("Unexpected EVENTS pagination");
}

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
const current = [...cards.values()].filter(event => !event.end || event.end >= today);
current.sort((a, b) => a.start.localeCompare(b.start));
await writeFile(new URL("./events.json", import.meta.url), JSON.stringify(current, null, 2) + "\n", "utf8");
console.log("Generated " + current.length + " active or upcoming official events.");

import {writeFile} from "node:fs/promises";

const catalog = "https://hololive.hololivepro.com/music/";
const limit = 20;
const items = new Map();
const entities = {amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " "};

function plainText(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (!entity.startsWith("#")) return entities[entity] ?? match;
    const hex = entity[1].toLowerCase() === "x";
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }).replace(/\s+/g, " ").trim();
}

for (let page = 1; page <= 3 && items.size < limit; page++) {
  const url = new URL(catalog);
  if (page > 1) url.searchParams.set("paged", page);
  const response = await fetch(url, {signal: AbortSignal.timeout(15_000)});
  if (!response.ok) throw new Error("Official MUSIC HTTP " + response.status);
  const html = await response.text();
  const links = /<a\b[^>]*\shref=["']((?:https:\/\/hololive\.hololivepro\.com)?\/music\/(\d+)\/)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const [, link, id, markup] of html.matchAll(links)) {
    if (items.has(id)) continue;
    const src = markup.match(/<img\b[^>]*\ssrc=["']([^"']+)["']/i)?.[1];
    const heading = markup.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    if (!src || !heading) continue;
    const image = new URL(src.replaceAll("&amp;", "&"), catalog);
    const title = plainText(heading);
    if (image.protocol !== "https:" || !title) continue;
    const artist = plainText(markup.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    items.set(id, { id, title, artist, image: image.href, href: new URL(link, catalog).href });
  }
}
if (items.size < limit) throw new Error("Expected 20 MUSIC releases, found " + items.size);
const releases = [...items.values()].slice(0, limit);
await writeFile(new URL("./music.json", import.meta.url), JSON.stringify(releases, null, 2) + "\n");
console.log("Generated " + releases.length + " official MUSIC releases.");

import {writeFile} from "node:fs/promises";

const shop = "https://shop.hololivepro.com";
const url = shop + "/collections/all?sort_by=created-descending&country=JP";
const response = await fetch(url, {cache: "no-store", signal: AbortSignal.timeout(15_000)});
if (!response.ok) throw new Error("Official shop HTTP " + response.status);

const html = await response.text();
const country = html.match(/Shopify\.country\s*=\s*"([^"]+)"/)?.[1];
if (country !== "JP") throw new Error("Official shop did not return the Japan catalog");
const items = new Map();
const links = /<a\b[^>]*class="Item_inner"[^>]*href="(\/products\/[\w-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
for (const [, path, card] of html.matchAll(links)) {
  const imageTag = card.match(/<img\b[^>]*class="primary-image"[^>]*>/i)?.[0];
  const src = imageTag?.match(/\ssrc="([^"]+)"/i)?.[1];
  const title = imageTag?.match(/\salt="([^"]+)"/i)?.[1]?.replace(/&(amp|quot|apos|lt|gt|#39);/g,
    (_, code) => ({amp:"&",quot:'"',apos:"'",lt:"<",gt:">","#39":"'"})[code]).trim();
  if (!title || !src) continue;
  const image = new URL(src.replaceAll("&amp;", "&"), shop);
  if (image.protocol !== "https:") continue;
  items.set(path, {title, image:image.href, href:new URL(path, shop).href});
  if (items.size === 20) break;
}
if (items.size !== 20) throw new Error("Expected 20 official shop products, found " + items.size);
await writeFile(new URL("./goods.json", import.meta.url), JSON.stringify([...items.values()], null, 2) + "\n");
console.log("Generated 20 official shop cards.");

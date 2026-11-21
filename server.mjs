import {readFile} from "node:fs/promises";
import {createServer} from "node:http";

const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/news.json", ["news.json", "application/json; charset=utf-8"]],
  ...["LIVE", "ARCHIVE", "NEWS"].map(name => [
    "/" + name + "_background.png", [name + "_background.png", "image/png"]
  ])
]);

createServer(async (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, {Allow: "GET"}).end();
    return;
  }
  const file = files.get(request.url.split("?")[0]);
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, {"Content-Type": file[1], "Cache-Control": "no-cache"}).end(body);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
  }
}).listen(8787, "127.0.0.1", () => console.log("http://127.0.0.1:8787"));

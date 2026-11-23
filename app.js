"use strict";
const apiKey = "1f0fbcba-f11a-4a42-8647-ec4d3dc2f90c";
const template = document.querySelector("#card-template");
const refreshInterval = 60_000;
const speed = 48;
const archiveWindow = 12 * 60 * 60 * 1000;

async function fetchVideos(path, params) {
  const query = new URLSearchParams({ org: "Hololive", type: "stream", ...params });
  const response = await fetch("https://holodex.net/api/v2/" + path + "?" + query, {
    headers: { "X-APIKEY": apiKey },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store"
  });
  if (!response.ok) {
    const error = new Error("Holodex returned " + response.status);
    error.status = response.status;
    throw error;
  }
  const videos = await response.json();
  if (!Array.isArray(videos)) throw new Error("Invalid Holodex response");
  return videos;
}

const liveMemberGroups = /^(?:\d+(?:st|nd|rd|th) Generation\b|GAMERS$|English -|Indonesia |DEV_IS |ASOBI★MAWARI-TAI!$)/;
let liveMembers;
let liveMembersExpireAt = 0;

async function fetchLiveMembers() {
  const ids = new Set();
  const limit = 50;
  for (let offset = 0; ; offset += limit) {
    const channels = await fetchVideos("channels", { type: "vtuber", limit, offset });
    for (const channel of channels) {
      if (channel.org === "Hololive" && channel.inactive === false && liveMemberGroups.test(channel.group)) {
        ids.add(channel.id);
      }
    }
    if (channels.length < limit) break;
  }
  if (!ids.size) throw new Error("No active hololive member channels returned");
  return ids;
}

function getLiveMembers() {
  if (!liveMembers || Date.now() >= liveMembersExpireAt) {
    liveMembersExpireAt = Date.now() + 10 * 60_000;
    liveMembers = fetchLiveMembers().catch(error => {
      liveMembers = undefined;
      throw error;
    });
  }
  return liveMembers;
}

async function loadMemberLive() {
  const members = await getLiveMembers();
  const streams = await fetchVideos("live", { status: "live" });
  return streams.filter(stream => members.has(stream.channel?.id));
}

async function loadArchive() {
  const members = await getLiveMembers();
  const now = Date.now();
  const cutoff = now - archiveWindow;
  const limit = 50;
  const archives = [];
  for (let offset = 0; ; offset += limit) {
    const page = await fetchVideos("videos", {
      status: "past", include: "live_info", sort: "end_actual", order: "desc", limit, offset
    });
    for (const video of page) {
      const endedAt = Date.parse(video?.end_actual);
      if (video?.status === "past" && members.has(video.channel?.id) && endedAt >= cutoff && endedAt <= now) archives.push(video);
    }
    if (page.length < limit || !(Date.parse(page.at(-1)?.end_actual) >= cutoff)) break;
  }
  return archives;
}

async function loadNews() {
  if (location.protocol === "file:") {
    throw new Error("NEWSを表示するには、GitHub Pagesまたはローカルサーバーでページを開いてください。");
  }
  const response = await fetch("./news.json", {
    cache: "no-store", signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error("Instagramのカード一覧を取得できませんでした。");
  const result = await response.json();
  if (!Array.isArray(result)) throw new Error("Instagramのデータ形式を確認してください。");
  return result;
}

const featuredThumbnail = document.querySelector("#featured-thumbnail");
const featuredHeading = document.querySelector("#featured-heading");
const featuredTitle = document.querySelector("#featured-title");
const featuredStatus = document.querySelector("#featured-status");
let featuredId;

function useStandardFeaturedThumbnail() {
  if (featuredThumbnail.getAttribute("src")?.endsWith("/maxresdefault.jpg")) {
    featuredThumbnail.src = "https://i.ytimg.com/vi/" + featuredId + "/mqdefault.jpg";
  }
}

featuredThumbnail.addEventListener("error", useStandardFeaturedThumbnail);
featuredThumbnail.addEventListener("load", () => {
  if (featuredThumbnail.naturalWidth < 480) useStandardFeaturedThumbnail();
});

const featuredRotationMs = 8_000;
let featuredVideos = [];
let rotatingFeatured = false;

function showFeatured(video, imageUrl) {
  if (!video) {
    featuredId = undefined;
    featuredThumbnail.removeAttribute("src");
    featuredThumbnail.hidden = true;
    featuredHeading.hidden = true;
    featuredStatus.textContent = "現在ライブ配信中の枠はありません";
    featuredStatus.hidden = false;
    return;
  }
  featuredTitle.textContent = video.title;
  if (video.id !== featuredId) {
    featuredId = video.id;
    featuredThumbnail.src = imageUrl ?? "https://i.ytimg.com/vi/" + video.id + "/maxresdefault.jpg";
  }
  featuredThumbnail.hidden = false;
  featuredHeading.hidden = false;
  featuredStatus.hidden = true;
}

function randomFeatured(videos) {
  return videos[Math.floor(Math.random() * videos.length)];
}

function updateFeatured(videos) {
  featuredVideos = videos;
  showFeatured(videos.find(video => video.id === featuredId) ?? randomFeatured(videos));
}

async function loadFeaturedImage(id) {
  const base = "https://i.ytimg.com/vi/" + id + "/";
  for (const size of ["maxresdefault", "mqdefault"]) {
    const image = new Image();
    image.src = base + size + ".jpg";
    try {
      await image.decode();
      if (size === "mqdefault" || image.naturalWidth >= 480) return image.src;
    } catch {
      // Try the standard thumbnail if the larger image is unavailable.
    }
  }
  return null;
}

async function rotateFeatured() {
  if (rotatingFeatured || document.hidden || featuredVideos.length < 2) return;
  const previousId = featuredId;
  const candidate = randomFeatured(featuredVideos.filter(video => video.id !== previousId));
  rotatingFeatured = true;
  const overlays = [];
  const animations = [];
  try {
    const imageUrl = await loadFeaturedImage(candidate.id);
    const next = featuredVideos.find(video => video.id === candidate.id);
    if (!imageUrl || !next || featuredId !== previousId || featuredVideos.length < 2 || document.hidden) return;
    for (const element of [featuredThumbnail, featuredHeading]) {
      const overlay = element.cloneNode(true);
      overlay.removeAttribute("id");
      overlay.querySelector("[id]")?.removeAttribute("id");
      overlay.setAttribute("aria-hidden", "true");
      element.after(overlay);
      overlays.push(overlay);
    }
    showFeatured(next, imageUrl);
    const options = { duration: 3_000, easing: "ease-in-out", fill: "both" };
    animations.push(
      overlays[0].animate([{opacity: 1}, {opacity: 0}], options),
      overlays[1].animate([{opacity: 1}, {opacity: 0}], options),
      featuredHeading.animate([{opacity: 0}, {opacity: 1}], options)
    );
    await Promise.all(animations.map(animation => animation.finished));
  } finally {
    for (const overlay of overlays) overlay.remove();
    for (const animation of animations) animation.cancel();
    rotatingFeatured = false;
  }
}

setInterval(rotateFeatured, featuredRotationMs);

function startBelt(belt, loadVideos, expectedStatus, emptyMessage) {
  const track = belt.querySelector(".track");
  const previous = belt.querySelector(".previous");
  const next = belt.querySelector(".next");
  const status = belt.querySelector(".status");
  let signature = "";
  let position = 0;
  let groupWidth = 0;
  let lastFrame = 0;
  let slide;
  let drag;
  let suppressClick = false;

  function message(text) {
    status.textContent = text;
    status.hidden = !text;
    previous.hidden = track.hidden;
    next.hidden = track.hidden;
  }

  function resizeTrack() {
    if (track.hidden || !track.firstElementChild) return;
    groupWidth = track.firstElementChild.getBoundingClientRect().width;
    const copies = 1 + Math.ceil(belt.clientWidth / groupWidth);
    while (track.children.length > copies) track.lastElementChild.remove();
    while (track.children.length < copies) {
      const copy = track.firstElementChild.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      for (const link of copy.querySelectorAll("a")) link.tabIndex = -1;
      track.append(copy);
    }
  }

  function render(videos) {
    if (!videos.length) {
      track.hidden = true;
      message(emptyMessage);
      return;
    }
    track.hidden = false;
    message("");
    const nextSignature = JSON.stringify(videos);
    if (nextSignature !== signature) {
      const group = document.createElement("div");
      group.className = "group";
      for (const video of videos) {
        const card = template.content.firstElementChild.cloneNode(true);
        card.href = video.href || "https://www.youtube.com/watch?v=" + video.id;
        const image = card.querySelector("img");
        const imageUrl = expectedStatus === "news" ? video.image : "https://i.ytimg.com/vi/" + video.id + "/mqdefault.jpg";
        if (imageUrl) image.src = imageUrl;
        card.querySelector(".badge").textContent = belt.dataset.label;
        card.querySelector(".channel").textContent = video.channel;
        card.querySelector(".title").textContent = video.title;
        group.append(card);
      }
      track.replaceChildren(group);
      signature = nextSignature;
    }
    resizeTrack();
  }

  async function refresh() {
    try {
      const results = await loadVideos();
      const videos = new Map();
      for (const video of results) {
        if (video?.status !== expectedStatus || typeof video.id !== "string") continue;
        if (expectedStatus === "news") {
          videos.set(video.id, video);
          continue;
        }
        if (!/^[\w-]{11}$/.test(video.id)) continue;
        videos.set(video.id, {
          id: video.id,
          channel: video.channel?.name || video.channel?.english_name || "チャンネル名なし",
          title: video.title || "タイトルなし"
        });
      }
      const cards = [...videos.values()];
      if (expectedStatus === "live") updateFeatured(cards);
      render(cards);
    } catch (error) {
      if (expectedStatus === "live" && !featuredId) {
        featuredStatus.textContent = "配信情報を取得できませんでした。再試行します。";
      }
      track.hidden = true;
      message(expectedStatus === "news" ? error.message : error.status === 401 || error.status === 403
        ? "Holodex APIキーを確認してください。"
        : "配信情報を取得できませんでした。60秒後に再試行します。");
    } finally {
      setTimeout(refresh, refreshInterval);
    }
  }

  function moveBy(distance) {
    position = ((position + distance) % groupWidth + groupWidth) % groupWidth;
    track.style.transform = "translateX(" + -position + "px)";
  }

  function step(direction) {
    const count = track.firstElementChild?.children.length;
    if (!count || !groupWidth || drag) return;
    const distance = direction * 4 * groupWidth / count;
    slide = { startedAt: performance.now(), distance, applied: 0 };
  }

  function animate(now) {
    const elapsed = Math.min(now - (lastFrame || now), 50);
    lastFrame = now;
    if (!track.hidden && groupWidth && !drag) {
      if (slide) {
        const progress = Math.max(0, Math.min(1, (now - slide.startedAt) / 650));
        const distance = slide.distance * (1 - (1 - progress) ** 3);
        moveBy(distance - slide.applied);
        slide.applied = distance;
        if (progress === 1) slide = undefined;
      } else {
        moveBy(speed * elapsed / 1000);
      }
    }
    requestAnimationFrame(animate);
  }

  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  track.addEventListener("dragstart", event => event.preventDefault());
  track.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    slide = undefined;
    drag = { id: event.pointerId, x: event.clientX, moved: false };
  });

  window.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    const distance = drag.x - event.clientX;
    if (!drag.moved && Math.abs(distance) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      track.setPointerCapture(event.pointerId);
      track.classList.add("dragging");
    }
    drag.x = event.clientX;
    moveBy(distance);
  });

  function endDrag(event) {
    if (drag?.id !== event.pointerId) return;
    suppressClick = drag.moved;
    drag = undefined;
    track.classList.remove("dragging");
  }

  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  track.addEventListener("lostpointercapture", endDrag);
  track.addEventListener("click", event => {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault();
    suppressClick = false;
  }, true);

  window.addEventListener("resize", resizeTrack);
  requestAnimationFrame(animate);
  refresh();
}

startBelt(document.querySelector('[data-label="LIVE"]'),
  loadMemberLive, "live",
  "現在ライブ配信中の枠はありません");
startBelt(document.querySelector('[data-label="ARCHIVE"]'),
  loadArchive, "past",
  "直近12時間に終了した配信はありません");
startBelt(document.querySelector('[data-label="NEWS"]'), loadNews, "news",
  "Instagramの投稿はありません");
let scrollFrame = 0;
let scrollTarget = 0;
let scrollPosition = 0;
let scrollLastTime = 0;

function stopPageScroll() {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
}

function animatePageScroll(now) {
  const elapsed = Math.min(now - scrollLastTime, 50);
  scrollLastTime = now;
  scrollPosition += (scrollTarget - scrollPosition) * (1 - Math.exp(-elapsed / 95));
  if (Math.abs(scrollPosition - scrollTarget) < 0.5) {
    window.scrollTo({top: scrollTarget, behavior: "instant"});
    scrollFrame = 0;
    return;
  }
  window.scrollTo({top: scrollPosition, behavior: "instant"});
  scrollFrame = requestAnimationFrame(animatePageScroll);
}

function startPageScroll(target) {
  scrollTarget = target;
  if (scrollFrame) return;
  scrollPosition = window.scrollY;
  scrollLastTime = performance.now();
  scrollFrame = requestAnimationFrame(animatePageScroll);
}

window.addEventListener("wheel", event => {
  const mode = event.deltaMode;
  const delta = event.deltaY;
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!event.cancelable || Math.abs(event.deltaX) >= Math.abs(delta)) {
    stopPageScroll();
    return;
  }

  const page = document.scrollingElement;
  const maxScroll = Math.max(0, page.scrollHeight - page.clientHeight);
  const distance = delta * (mode === 1 ? 16 : mode === 2 ? page.clientHeight : 1);
  event.preventDefault();
  startPageScroll(Math.min(maxScroll, Math.max(0, (scrollFrame ? scrollTarget : window.scrollY) + distance)));
}, {passive: false});

window.addEventListener("pointerdown", stopPageScroll);
window.addEventListener("keydown", stopPageScroll);

function startCatalog(catalog, label) {
  const musicTrack = document.querySelector("#" + catalog + "-track");
  const musicPrevious = document.querySelector("#" + catalog + "-prev");
  const musicNext = document.querySelector("#" + catalog + "-next");
  const musicStatus = document.querySelector("#" + catalog + "-status");
  const musicMore = musicTrack.querySelector(".music-more");
  let musicSignature = "";
  let musicDrag;
  let suppressMusicClick = false;

  function updateMusicButtons() {
    musicPrevious.disabled = musicTrack.scrollLeft <= 1;
    musicNext.disabled = musicTrack.scrollLeft + musicTrack.clientWidth >= musicTrack.scrollWidth - 1;
  }

  function moveMusic(direction) {
    const first = musicTrack.querySelector(".music-card");
    if (!first) return;
    const gap = Number.parseFloat(getComputedStyle(musicTrack).columnGap);
    musicTrack.scrollBy({
      left: direction * 4 * (first.getBoundingClientRect().width + gap),
      behavior: "smooth"
    });
  }

  async function refreshMusic() {
    try {
      const response = await fetch("./" + catalog + ".json", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("MUSIC HTTP " + response.status);
      const releases = await response.json();
      if (!Array.isArray(releases) || !releases.length) throw new Error("MUSIC feed empty");
      const signature = JSON.stringify(releases);
      if (musicSignature === signature || musicDrag) return;
      const position = musicTrack.scrollLeft;
      const cards = releases.slice(0, 20).map(release => {
        const card = document.createElement("a");
        card.className = "music-card";
        card.href = release.href;
        card.title = release.title;
        card.innerHTML = '<img alt="" loading="lazy" draggable="false"><strong class="music-title"></strong><span class="music-artist"></span>';
        card.querySelector("img").src = release.image;
        card.querySelector(".music-title").textContent = release.title;
        const artist = card.querySelector(".music-artist");
        if (release.artist) artist.textContent = release.artist;
        else artist.remove();
        return card;
      });
      musicTrack.replaceChildren(...cards, musicMore);
      musicTrack.scrollLeft = position;
      musicSignature = signature;
      musicStatus.hidden = true;
      updateMusicButtons();
    } catch {
      if (!musicSignature) musicStatus.textContent = label + "を取得できませんでした。しばらくすると再試行します。";
    } finally {
      setTimeout(refreshMusic, 60_000);
    }
  }

  musicPrevious.addEventListener("click", () => moveMusic(-1));
  musicNext.addEventListener("click", () => moveMusic(1));
  musicTrack.addEventListener("scroll", updateMusicButtons, { passive: true });
  window.addEventListener("resize", updateMusicButtons);

  musicTrack.addEventListener("dragstart", event => event.preventDefault());
  musicTrack.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressMusicClick = false;
    musicDrag = { id: event.pointerId, x: event.clientX, left: musicTrack.scrollLeft, moved: false };
  });
  window.addEventListener("pointermove", event => {
    if (musicDrag?.id !== event.pointerId) return;
    const dx = musicDrag.x - event.clientX;
    if (!musicDrag.moved && Math.abs(dx) < 5) return;
    if (!musicDrag.moved) {
      musicDrag.moved = true;
      musicTrack.setPointerCapture(event.pointerId);
      musicTrack.classList.add("dragging");
    }
    musicTrack.scrollLeft = musicDrag.left + dx;
  });
  function endMusicDrag(event) {
    if (musicDrag?.id !== event.pointerId) return;
    suppressMusicClick = musicDrag.moved;
    musicDrag = undefined;
    musicTrack.classList.remove("dragging");
  }
  window.addEventListener("pointerup", endMusicDrag);
  window.addEventListener("pointercancel", endMusicDrag);
  musicTrack.addEventListener("lostpointercapture", endMusicDrag);
  musicTrack.addEventListener("click", event => {
    if (!suppressMusicClick || event.detail === 0) return;
    event.preventDefault();
    suppressMusicClick = false;
  }, true);
  refreshMusic();
}
startCatalog("music", "楽曲");
startCatalog("goods", "グッズ");

const eventStatus = document.querySelector("#events-status");
const eventGroups = document.querySelector("#events-groups");
const currentEvents = document.querySelector("#events-current");
const upcomingEvents = document.querySelector("#events-upcoming");
let eventSignature = "";

function renderEventGroup(container, events, emptyMessage) {
  if (!events.length) {
    const message = document.createElement("p");
    message.textContent = emptyMessage;
    container.replaceChildren(message);
    return;
  }
  const cards = events.map(event => {
    const card = document.createElement("a");
    card.className = "official-card";
    card.href = event.href;
    if (event.image) {
      const image = document.createElement("img");
      image.src = event.image;
      image.alt = "";
      image.loading = "lazy";
      card.append(image);
    }
    const title = document.createElement("strong");
    title.textContent = event.title;
    const date = document.createElement("span");
    date.className = "event-date";
    date.textContent = event.dateLabel;
    card.append(title, date);
    return card;
  });
  container.replaceChildren(...cards);
}

async function refreshEvents() {
  try {
    const response = await fetch("./events.json", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("EVENTS HTTP " + response.status);
    const events = await response.json();
    if (!Array.isArray(events)) throw new Error("Invalid EVENTS data");
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
    const signature = today + JSON.stringify(events);
    if (eventSignature === signature) return;
    const current = events.filter(event => event.start <= today && (!event.end || event.end >= today));
    const upcoming = events.filter(event => event.start > today);
    renderEventGroup(currentEvents, current, "開催中のイベントはありません。");
    renderEventGroup(upcomingEvents, upcoming, "開催予定のイベントはありません。");
    eventSignature = signature;
    eventStatus.hidden = true;
    eventGroups.hidden = false;
  } catch {
    if (!eventSignature) eventStatus.textContent = "イベント情報を取得できませんでした。";
  } finally {
    setTimeout(refreshEvents, 60_000);
  }
}
refreshEvents();

const backToTop = document.querySelector("#back-to-top");

function updateBackToTop() {
  backToTop.hidden = window.scrollY < 320;
}

backToTop.addEventListener("click", () => {
  stopPageScroll();
  document.querySelector(".featured h1").focus({ preventScroll: true });
  startPageScroll(0);
});
window.addEventListener("scroll", updateBackToTop, { passive: true });
updateBackToTop();

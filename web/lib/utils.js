export function slugifyTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";
}

export function sanitizeStorageName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "untitled";
}

export function extractMangaId(readUrl) {
  const raw = String(readUrl || "");
  const match = raw.match(/[?&]id=([^&#]+)/i);
  return match?.[1]?.trim() || "";
}

export function buildTitlePaths(mangaId, title = "") {
  const safeId = String(mangaId || "").trim() || "untitled";
  const storageName = sanitizeStorageName(title || safeId);
  return {
    slug: safeId,
    storageName,
    prefix: `titles/${storageName}`,
    manifestKey: `titles/${storageName}/manifest.json`
  };
}

export function buildLegacyTitlePaths(title = "", mangaId = "") {
  const safeSlug = slugifyTitle(title || mangaId);
  return {
    slug: safeSlug,
    storageName: safeSlug,
    prefix: `titles/${safeSlug}`,
    manifestKey: `titles/${safeSlug}/manifest.json`
  };
}

export function canUseLegacyTitlePaths(title = "", mangaId = "") {
  const safeSlug = slugifyTitle(title || mangaId);

  if (!safeSlug) {
    return false;
  }

  if (safeSlug === "untitled" && String(title || "").trim()) {
    return false;
  }

  return true;
}

export function buildTitleAssetBase(publicBaseUrl, mangaId, title = "") {
  const safeBase = String(publicBaseUrl || "").replace(/\/+$/, "");
  const { prefix } = buildTitlePaths(mangaId, title);
  return `${safeBase}/${prefix}`;
}

export function buildLibraryEntry(item) {
  const slug = extractMangaId(item.read_url) || slugifyTitle(item.title);
  return {
    ...item,
    slug,
    storageName: sanitizeStorageName(item.title)
  };
}

export function chapterSortValue(name) {
  const match = String(name || "").match(/^(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

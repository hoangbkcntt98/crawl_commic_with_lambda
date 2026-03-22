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

export function buildTitlePaths(slug, title = "") {
  const safeSlug = slugifyTitle(slug);
  const storageName = sanitizeStorageName(title || slug);
  return {
    slug: safeSlug,
    storageName,
    prefix: `titles/${storageName}`,
    manifestKey: `titles/${storageName}/manifest.json`
  };
}

export function buildLegacyTitlePaths(slug) {
  const safeSlug = slugifyTitle(slug);
  return {
    slug: safeSlug,
    storageName: safeSlug,
    prefix: `titles/${safeSlug}`,
    manifestKey: `titles/${safeSlug}/manifest.json`
  };
}

export function buildTitleAssetBase(publicBaseUrl, slug, title = "") {
  const safeBase = String(publicBaseUrl || "").replace(/\/+$/, "");
  const { prefix } = buildTitlePaths(slug, title);
  return `${safeBase}/${prefix}`;
}

export function buildLibraryEntry(item) {
  const slug = slugifyTitle(item.title);
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

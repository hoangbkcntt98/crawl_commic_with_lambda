import "server-only";

import { notFound } from "next/navigation";

import {
  BROWSE_SORT,
  BROWSE_URL,
  MANGA_MANIFEST_TABLE,
  MAX_IMAGES_PER_CHAPTER,
  MAX_PAGES,
  publicS3BaseUrl,
  S3_BUCKET,
  S3_PREFIX,
  WAIT_SEC
} from "@/lib/config";
import { getJsonFromS3, invokeLambda, objectExists } from "@/lib/server/aws";
import {
  findLibraryItemById,
  getLibraryFromDb,
  getManifestFromDb,
  saveLibraryToDb,
  saveManifestToDb,
  upsertLibraryItemToDb
} from "@/lib/server/metadata-db";
import {
  buildLegacyTitlePaths,
  buildChapterStorageName,
  buildTitlePaths,
  canUseLegacyTitlePaths,
  chapterSortValue,
  extractMangaId
} from "@/lib/utils";

export async function getLibrary() {
  return getLibraryFromDb();
}

function pickMetaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractJsonLdBlocks(html) {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const blocks = [];

  for (const match of matches) {
    const raw = match?.[1]?.trim();
    if (!raw) {
      continue;
    }

    try {
      blocks.push(JSON.parse(raw));
    } catch {}
  }

  return blocks;
}

function stripRawSuffix(title) {
  return String(title || "")
    .replace(/\s+Raw(?:\s+Free)?$/i, "")
    .replace(/\s+無料.*$/i, "")
    .trim();
}

function findBreadcrumbTitleAndDetailUrl(jsonLdBlocks) {
  for (const block of jsonLdBlocks) {
    const graph = Array.isArray(block?.["@graph"]) ? block["@graph"] : [];
    const breadcrumb = graph.find((entry) => entry?.["@type"] === "BreadcrumbList");
    const elements = Array.isArray(breadcrumb?.itemListElement) ? breadcrumb.itemListElement : [];
    const mangaItem = elements.find((entry) => Number(entry?.position) === 2);

    if (mangaItem?.name || mangaItem?.item) {
      return {
        title: stripRawSuffix(mangaItem?.name || ""),
        detailUrl: String(mangaItem?.item || "").trim()
      };
    }
  }

  return {
    title: "",
    detailUrl: ""
  };
}

async function fetchPageHtml(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Khong the tai trang MangaRW: ${response.status}`);
  }

  return response.text();
}

function extractReadUrlFromHtml(html, fallbackUrl = "") {
  const canonical = pickMetaContent(html, "og:url");
  if (canonical.includes("/read?id=")) {
    return canonical;
  }

  const hrefMatch = html.match(/href=["']([^"']*\/read\?id=[^"']+)["']/i);
  if (hrefMatch?.[1]) {
    return new URL(hrefMatch[1], fallbackUrl || "https://mangarw.com").toString();
  }

  if (String(fallbackUrl).includes("/read?id=")) {
    return fallbackUrl;
  }

  return "";
}

async function resolveManualMangaItem(inputUrl) {
  const normalizedInput = String(inputUrl || "").trim();
  if (!normalizedInput) {
    throw new Error("Hay nhap duong dan truyen MangaRW.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedInput);
  } catch {
    throw new Error("Duong dan khong hop le.");
  }

  if (!/mangarw\.com$/i.test(parsedUrl.hostname)) {
    throw new Error("Chi ho tro duong dan tu mangarw.com.");
  }

  const html = await fetchPageHtml(parsedUrl.toString());
  const readUrl = extractReadUrlFromHtml(html, parsedUrl.toString());
  if (!readUrl) {
    throw new Error("Khong tim thay read URL tu trang da nhap.");
  }

  const jsonLdBlocks = extractJsonLdBlocks(html);
  const breadcrumbInfo = findBreadcrumbTitleAndDetailUrl(jsonLdBlocks);
  const ogTitle = decodeHtmlEntities(pickMetaContent(html, "og:title"));
  const ogImage = decodeHtmlEntities(pickMetaContent(html, "og:image"));

  const title = breadcrumbInfo.title || stripRawSuffix(ogTitle) || `Manga ${extractMangaId(readUrl)}`;
  const detailUrl =
    breadcrumbInfo.detailUrl ||
    (parsedUrl.pathname.includes("/manga/") ? parsedUrl.toString() : "");

  return {
    title,
    detail_url: detailUrl,
    read_url: readUrl,
    image_url: ogImage,
    updated_at: new Date().toISOString()
  };
}

export async function triggerLibrarySync(page = 1) {
  const result = await invokeLambda(
    {
      action: "list_browse_links",
      browse_url: BROWSE_URL,
      wait_sec: WAIT_SEC,
      max_pages: 1,
      start_page: Number(page),
      sort: BROWSE_SORT
    },
    "RequestResponse"
  );

  const payload = {
    title: "MangaRW Library",
    browse_url: BROWSE_URL,
    sort: BROWSE_SORT,
    max_pages: 1,
    current_page: Number(page),
    count: result.body?.count || 0,
    updated_at: new Date().toISOString(),
    items: result.body?.items || [],
    pairs: result.body?.pairs || []
  };

  await saveLibraryToDb(payload);

  return {
    statusCode: 200,
    body: {
      ...payload,
      persisted_to: "postgres"
    }
  };
}

export async function addMangaToLibrary(inputUrl) {
  const resolvedItem = await resolveManualMangaItem(inputUrl);
  const mangaId = extractMangaId(resolvedItem.read_url);
  if (!mangaId) {
    throw new Error("Khong lay duoc manga id tu read URL.");
  }

  const catalogResult = await invokeLambda(
    {
      action: "get_catalog",
      start_url: resolvedItem.read_url,
      wait_sec: WAIT_SEC
    },
    "RequestResponse"
  );

  const catalog = Array.isArray(catalogResult.body?.catalog) ? catalogResult.body.catalog : [];
  const savedItem = await upsertLibraryItemToDb({
    ...resolvedItem,
    slug: mangaId
  });

  return {
    item: savedItem,
    chapter_count: catalog.length
  };
}

export async function findMangaBySlug(slug) {
  const [library, item] = await Promise.all([getLibrary(), findLibraryItemById(slug)]);
  return { library, item };
}

export async function getMangaManifest(slug, title = "") {
  const dbManifest = await getManifestFromDb(slug);
  if (dbManifest) {
    const chapters = Array.isArray(dbManifest.chapters)
      ? [...dbManifest.chapters].sort(
          (left, right) => chapterSortValue(left.name) - chapterSortValue(right.name)
        )
      : [];
    const expectedChapters = Number(dbManifest?.progress?.expected_chapters || 0);
    const completedChapters = chapters.length;
    const status =
      expectedChapters > 0
        ? completedChapters >= expectedChapters
          ? "completed"
          : "downloading"
        : completedChapters > 0
          ? "completed"
          : "idle";

    return {
      ...dbManifest,
      chapters,
      progress: {
        status,
        expected_chapters: expectedChapters,
        completed_chapters: completedChapters
      },
      assetBaseUrl: `${String(publicS3BaseUrl || "").replace(/\/+$/, "")}/${S3_PREFIX}/titles/${dbManifest.storage_name || buildTitlePaths(slug, title).storageName}`
    };
  }

  if (!S3_BUCKET) {
    return null;
  }

  const primaryPaths = buildTitlePaths(slug, title);
  const legacyPaths = buildLegacyTitlePaths(title, slug);
  const candidates = [primaryPaths];

  if (
    canUseLegacyTitlePaths(title, slug) &&
    legacyPaths.manifestKey !== primaryPaths.manifestKey
  ) {
    candidates.push(legacyPaths);
  }

  const matchedPaths = await (async () => {
    for (const paths of candidates) {
      const exists = await objectExists(S3_BUCKET, `${S3_PREFIX}/${paths.manifestKey}`);
      if (exists) {
        return paths;
      }
    }
    return null;
  })();

  if (!matchedPaths) {
    return null;
  }

  const manifest = await getJsonFromS3(S3_BUCKET, `${S3_PREFIX}/${matchedPaths.manifestKey}`);
  const chapters = Array.isArray(manifest.chapters)
    ? [...manifest.chapters].sort(
        (left, right) => chapterSortValue(left.name) - chapterSortValue(right.name)
      )
    : [];
  const expectedChapters = Number(manifest?.progress?.expected_chapters || 0);
  const completedChapters = chapters.length;
  const status =
    expectedChapters > 0
      ? completedChapters >= expectedChapters
        ? "completed"
        : "downloading"
      : completedChapters > 0
        ? "completed"
        : "idle";

  return {
    ...manifest,
    chapters,
    progress: {
      status,
      expected_chapters: expectedChapters,
      completed_chapters: completedChapters
    },
    assetBaseUrl: `${String(publicS3BaseUrl || "").replace(/\/+$/, "")}/${S3_PREFIX}/${matchedPaths.prefix}`
  };
}

export async function getReaderData(slug) {
  const { item } = await findMangaBySlug(slug);
  if (!item) {
    notFound();
  }

  const manifest = await getMangaManifest(slug, item.title);
  return { item, manifest };
}

export async function triggerMangaDownload(slug) {
  const { item } = await findMangaBySlug(slug);
  if (!item) {
    throw new Error("Manga not found in library.");
  }

  const mangaId = extractMangaId(item.read_url) || String(slug);
  const paths = buildTitlePaths(mangaId, item.title);
  const catalogResult = await invokeLambda(
    {
      action: "get_catalog",
      start_url: item.read_url,
      wait_sec: WAIT_SEC
    },
    "RequestResponse"
  );

  const catalog = Array.isArray(catalogResult.body?.catalog) ? catalogResult.body.catalog : [];
  if (!catalog.length) {
    throw new Error("Khong lay duoc catalog chapter tu MangaRW.");
  }

  const chapterJobs = catalog.map((chapter) => {
    const payload = {
      action: "upload_to_s3",
      chapter_url: chapter.url,
      chapter_name: buildChapterStorageName(chapter),
      bucket: S3_BUCKET,
      prefix: `${S3_PREFIX}/${paths.prefix}`,
      manifest_key: `${S3_PREFIX}/${paths.manifestKey}`,
      manifest_table: MANGA_MANIFEST_TABLE,
      manga_id: mangaId,
      site_title: item.title
    };

    if (MAX_IMAGES_PER_CHAPTER) {
      payload.limit = Number(MAX_IMAGES_PER_CHAPTER);
    }

    return payload;
  });

  const existingManifest = await getManifestFromDb(mangaId);
  await saveManifestToDb(mangaId, {
    title: item.title,
    storage_name: paths.storageName,
    updated_at: new Date().toISOString(),
    chapters: Array.isArray(existingManifest?.chapters) ? existingManifest.chapters : [],
    progress: {
      status: "downloading",
      expected_chapters: chapterJobs.length,
      completed_chapters: Array.isArray(existingManifest?.chapters) ? existingManifest.chapters.length : 0
    }
  });

  for (const payload of chapterJobs) {
    await invokeLambda(payload, "Event");
  }

  return {
    statusCode: 202,
    body: {
      accepted: true,
      mode: "per_chapter_event_fanout",
      title: item.title,
      chapter_count: chapterJobs.length,
      manga_id: mangaId
    }
  };
}

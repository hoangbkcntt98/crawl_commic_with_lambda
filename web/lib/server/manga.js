import "server-only";

import { notFound } from "next/navigation";

import {
  BROWSE_SORT,
  BROWSE_URL,
  LIBRARY_S3_KEY,
  MAX_IMAGES_PER_CHAPTER,
  MAX_PAGES,
  publicS3BaseUrl,
  S3_BUCKET,
  S3_PREFIX,
  WAIT_SEC
} from "@/lib/config";
import { getJsonFromS3, getJsonFromS3OrNull, invokeLambda, objectExists, putJsonToS3 } from "@/lib/server/aws";
import {
  buildLegacyTitlePaths,
  buildLibraryEntry,
  buildChapterStorageName,
  buildTitlePaths,
  canUseLegacyTitlePaths,
  chapterSortValue,
  extractMangaId
} from "@/lib/utils";

export async function getLibrary() {
  if (!S3_BUCKET) {
    throw new Error("Missing S3_BUCKET environment variable.");
  }

  const data = await getJsonFromS3OrNull(S3_BUCKET, LIBRARY_S3_KEY);
  if (!data) {
    return {
      title: "MangaRW Library",
      updated_at: null,
      items: [],
      exists: false
    };
  }

  const items = Array.isArray(data.items) ? data.items.map(buildLibraryEntry) : [];

  return {
    ...data,
    items,
    exists: true
  };
}

export async function triggerLibrarySync() {
  if (!S3_BUCKET) {
    throw new Error("Missing S3_BUCKET environment variable.");
  }

  const syncPayload = {
    action: "list_browse_links_to_s3",
    browse_url: BROWSE_URL,
    bucket: S3_BUCKET,
    links_key: LIBRARY_S3_KEY,
    html_key: `${S3_PREFIX}/list.html`,
    wait_sec: WAIT_SEC,
    max_pages: MAX_PAGES,
    sort: BROWSE_SORT,
    page_title: "MangaRW Library"
  };

  try {
    return await invokeLambda(syncPayload, "RequestResponse");
  } catch (error) {
    if (!String(error?.message || "").includes("Unsupported action: list_browse_links_to_s3")) {
      throw error;
    }

    const fallbackPayload = {
      action: "list_browse_links",
      browse_url: BROWSE_URL,
      wait_sec: WAIT_SEC,
      max_pages: MAX_PAGES,
      sort: BROWSE_SORT
    };

    const result = await invokeLambda(fallbackPayload, "RequestResponse");
    const payload = {
      title: "MangaRW Library",
      browse_url: BROWSE_URL,
      sort: BROWSE_SORT,
      max_pages: MAX_PAGES,
      count: result.body?.count || 0,
      updated_at: new Date().toISOString(),
      items: result.body?.items || [],
      pairs: result.body?.pairs || []
    };

    await putJsonToS3(S3_BUCKET, LIBRARY_S3_KEY, payload);

    return {
      statusCode: 200,
      body: {
        ...payload,
        links_json_public_url: `${publicS3BaseUrl}/${LIBRARY_S3_KEY}`,
        fallback_used: true
      }
    };
  }
}

export async function findMangaBySlug(slug) {
  const library = await getLibrary();
  const item = library.items.find((entry) => entry.slug === String(slug));
  return { library, item };
}

export async function getMangaManifest(slug, title = "") {
  if (!S3_BUCKET) {
    throw new Error("Missing S3_BUCKET environment variable.");
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
      site_title: item.title
    };

    if (MAX_IMAGES_PER_CHAPTER) {
      payload.limit = Number(MAX_IMAGES_PER_CHAPTER);
    }

    return payload;
  });

  const existingManifest = await getJsonFromS3OrNull(S3_BUCKET, `${S3_PREFIX}/${paths.manifestKey}`);
  await putJsonToS3(S3_BUCKET, `${S3_PREFIX}/${paths.manifestKey}`, {
    title: item.title,
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

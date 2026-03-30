import "server-only";

import postgres from "postgres";

import { DATABASE_URL, MANGA_LIBRARY_TABLE, MANGA_MANIFEST_TABLE } from "@/lib/config";
import { buildLibraryEntry } from "@/lib/utils";

const LIBRARY_META_ID = "__meta__";
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertIdentifier(value, label) {
  if (!IDENTIFIER_RE.test(String(value || ""))) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

const libraryTable = assertIdentifier(MANGA_LIBRARY_TABLE, "MANGA_LIBRARY_TABLE");
const manifestTable = assertIdentifier(MANGA_MANIFEST_TABLE, "MANGA_MANIFEST_TABLE");
let sqlClient = null;

let ensured = false;

function getSql() {
  if (!DATABASE_URL) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }

  if (!sqlClient) {
    sqlClient = postgres(DATABASE_URL, {
      prepare: false
    });
  }

  return sqlClient;
}

async function ensureTables() {
  if (ensured) {
    return;
  }

  const sql = getSql();

  await sql.unsafe(`
    create table if not exists ${libraryTable} (
      manga_id text primary key,
      row_type text not null default 'manga',
      title text,
      detail_url text,
      read_url text,
      image_url text,
      slug text,
      storage_name text,
      item_count integer,
      updated_at timestamptz,
      extra jsonb not null default '{}'::jsonb
    )
  `);

  await sql.unsafe(`
    create table if not exists ${manifestTable} (
      manga_id text primary key,
      title text,
      storage_name text,
      chapters jsonb not null default '[]'::jsonb,
      progress jsonb not null default '{}'::jsonb,
      updated_at timestamptz
    )
  `);

  ensured = true;
}

export async function getLibraryFromDb() {
  await ensureTables();
  const sql = getSql();

  const metaRows = await sql.unsafe(
    `select title, updated_at, item_count, extra from ${libraryTable} where manga_id = $1 limit 1`,
    [LIBRARY_META_ID]
  );
  const rows = await sql.unsafe(
    `select manga_id, title, detail_url, read_url, image_url, slug, storage_name, updated_at
     from ${libraryTable}
     where row_type = 'manga'
     order by title asc`
  );

  const meta = metaRows[0] || null;
  const items = rows.map((row) =>
    buildLibraryEntry({
      manga_id: row.manga_id,
      title: row.title,
      detail_url: row.detail_url,
      read_url: row.read_url,
      image_url: row.image_url,
      slug: row.slug,
      storageName: row.storage_name,
      updated_at: row.updated_at
    })
  );

  return {
    title: meta?.title || "MangaRW Library",
    updated_at: meta?.updated_at ? new Date(meta.updated_at).toISOString() : null,
    count: items.length,
    current_page: Number(meta?.extra?.current_page || 1),
    items,
    exists: items.length > 0
  };
}

export async function findLibraryItemById(mangaId) {
  await ensureTables();
  const sql = getSql();
  const rows = await sql.unsafe(
    `select manga_id, title, detail_url, read_url, image_url, slug, storage_name, updated_at
     from ${libraryTable}
     where manga_id = $1 and row_type = 'manga'
     limit 1`,
    [String(mangaId)]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return buildLibraryEntry({
    manga_id: row.manga_id,
    title: row.title,
    detail_url: row.detail_url,
    read_url: row.read_url,
    image_url: row.image_url,
    slug: row.slug,
    storageName: row.storage_name,
    updated_at: row.updated_at
  });
}

export async function saveLibraryToDb(payload) {
  await ensureTables();
  const sql = getSql();

  const normalizedItems = Array.isArray(payload.items)
    ? payload.items.map((item) => buildLibraryEntry(item))
    : [];

  const mangaIds = normalizedItems.map((item) => String(item.slug));

  await sql.begin(async (trx) => {
    for (const item of normalizedItems) {
      await trx.unsafe(
        `insert into ${libraryTable}
          (manga_id, row_type, title, detail_url, read_url, image_url, slug, storage_name, updated_at)
         values ($1, 'manga', $2, $3, $4, $5, $6, $7, $8)
         on conflict (manga_id) do update
         set row_type = excluded.row_type,
             title = excluded.title,
             detail_url = excluded.detail_url,
             read_url = excluded.read_url,
             image_url = excluded.image_url,
             slug = excluded.slug,
             storage_name = excluded.storage_name,
             updated_at = excluded.updated_at`,
        [
          String(item.slug),
          item.title,
          item.detail_url,
          item.read_url,
          item.image_url,
          item.slug,
          item.storageName,
          payload.updated_at
        ]
      );
    }

    if (mangaIds.length) {
      await trx.unsafe(
        `delete from ${libraryTable}
         where row_type = 'manga' and not (manga_id = any($1::text[]))`,
        [mangaIds]
      );
    } else {
      await trx.unsafe(`delete from ${libraryTable} where row_type = 'manga'`);
    }

    await trx.unsafe(
      `insert into ${libraryTable}
        (manga_id, row_type, title, item_count, updated_at, extra)
       values ($1, 'meta', $2, $3, $4, $5::jsonb)
       on conflict (manga_id) do update
       set row_type = excluded.row_type,
           title = excluded.title,
           item_count = excluded.item_count,
           updated_at = excluded.updated_at,
           extra = excluded.extra`,
      [
        LIBRARY_META_ID,
        payload.title || "MangaRW Library",
        normalizedItems.length,
        payload.updated_at,
        JSON.stringify({ current_page: Number(payload.current_page || 1) })
      ]
    );
  });

  return {
    title: payload.title || "MangaRW Library",
    updated_at: payload.updated_at,
    count: normalizedItems.length,
    current_page: Number(payload.current_page || 1),
    items: normalizedItems,
    exists: normalizedItems.length > 0
  };
}

export async function upsertLibraryItemToDb(item) {
  await ensureTables();
  const sql = getSql();
  const normalizedItem = buildLibraryEntry(item);

  await sql.begin(async (trx) => {
    await trx.unsafe(
      `insert into ${libraryTable}
        (manga_id, row_type, title, detail_url, read_url, image_url, slug, storage_name, updated_at)
       values ($1, 'manga', $2, $3, $4, $5, $6, $7, $8)
       on conflict (manga_id) do update
       set row_type = excluded.row_type,
           title = excluded.title,
           detail_url = excluded.detail_url,
           read_url = excluded.read_url,
           image_url = excluded.image_url,
           slug = excluded.slug,
           storage_name = excluded.storage_name,
           updated_at = excluded.updated_at`,
      [
        String(normalizedItem.slug),
        normalizedItem.title,
        normalizedItem.detail_url,
        normalizedItem.read_url,
        normalizedItem.image_url,
        normalizedItem.slug,
        normalizedItem.storageName,
        normalizedItem.updated_at || new Date().toISOString()
      ]
    );

    const countRows = await trx.unsafe(
      `select count(*)::int as count from ${libraryTable} where row_type = 'manga'`
    );
    const totalCount = Number(countRows[0]?.count || 0);

    await trx.unsafe(
      `insert into ${libraryTable}
        (manga_id, row_type, title, item_count, updated_at, extra)
       values ($1, 'meta', $2, $3, $4, $5::jsonb)
       on conflict (manga_id) do update
       set row_type = excluded.row_type,
           title = excluded.title,
           item_count = excluded.item_count,
           updated_at = excluded.updated_at,
           extra = ${libraryTable}.extra || excluded.extra`,
      [
        LIBRARY_META_ID,
        "MangaRW Library",
        totalCount,
        normalizedItem.updated_at || new Date().toISOString(),
        JSON.stringify({ source: "manual_add" })
      ]
    );
  });

  return normalizedItem;
}

export async function getManifestFromDb(mangaId) {
  await ensureTables();
  const sql = getSql();
  const rows = await sql.unsafe(
    `select manga_id, title, storage_name, chapters, progress, updated_at
     from ${manifestTable}
     where manga_id = $1
     limit 1`,
    [String(mangaId)]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    manga_id: row.manga_id,
    title: row.title,
    storage_name: row.storage_name,
    chapters: Array.isArray(row.chapters) ? row.chapters : [],
    progress: row.progress || {},
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

export async function saveManifestToDb(mangaId, manifest) {
  await ensureTables();
  const sql = getSql();
  await sql.unsafe(
    `insert into ${manifestTable}
      (manga_id, title, storage_name, chapters, progress, updated_at)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     on conflict (manga_id) do update
     set title = excluded.title,
         storage_name = excluded.storage_name,
         chapters = excluded.chapters,
         progress = excluded.progress,
         updated_at = excluded.updated_at`,
    [
      String(mangaId),
      manifest.title || null,
      manifest.storage_name || null,
      JSON.stringify(Array.isArray(manifest.chapters) ? manifest.chapters : []),
      JSON.stringify(manifest.progress || {}),
      manifest.updated_at || null
    ]
  );
}

import { NextResponse } from "next/server";

import { addMangaToLibrary } from "@/lib/server/manga";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await addMangaToLibrary(body?.url || "");

    return NextResponse.json({
      ok: true,
      item: result.item,
      chapterCount: result.chapter_count || 0
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

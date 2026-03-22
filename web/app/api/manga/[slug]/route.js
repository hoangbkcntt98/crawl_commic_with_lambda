import { NextResponse } from "next/server";

import { findMangaBySlug, getMangaManifest } from "@/lib/server/manga";

export async function GET(_request, { params }) {
  try {
    const { slug } = await params;
    const { item } = await findMangaBySlug(slug);

    if (!item) {
      return NextResponse.json({ error: "Manga not found." }, { status: 404 });
    }

    const manifest = await getMangaManifest(slug);
    return NextResponse.json({ item, manifest });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

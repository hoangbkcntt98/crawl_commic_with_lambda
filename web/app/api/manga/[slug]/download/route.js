import { NextResponse } from "next/server";

import { triggerMangaDownload } from "@/lib/server/manga";

export async function POST(_request, { params }) {
  try {
    const { slug } = await params;
    const result = await triggerMangaDownload(slug);

    return NextResponse.json({
      ok: true,
      invocationType: "Event",
      message:
        "Da gui cac job crawl theo tung chapter len Lambda. Manifest cua title se duoc cap nhat dan tren S3 khi cac job chay xong.",
      result: result.body || null
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

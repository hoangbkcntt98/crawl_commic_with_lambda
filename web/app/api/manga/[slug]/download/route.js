import { NextResponse } from "next/server";

import { DOWNLOAD_INVOCATION_TYPE } from "@/lib/config";
import { triggerMangaDownload } from "@/lib/server/manga";

export async function POST(_request, { params }) {
  try {
    const { slug } = await params;
    const result = await triggerMangaDownload(slug);

    return NextResponse.json({
      ok: true,
      invocationType: DOWNLOAD_INVOCATION_TYPE,
      message:
        DOWNLOAD_INVOCATION_TYPE === "Event"
          ? "Da gui job crawl len Lambda. Manifest cua title se duoc cap nhat tren S3 sau khi job chay xong."
          : "Download va upload da hoan tat.",
      result: result.body || null
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

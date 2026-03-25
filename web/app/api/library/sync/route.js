import { NextResponse } from "next/server";

import { triggerLibrarySync } from "@/lib/server/manga";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const page = Number(body?.page || 1);
    const result = await triggerLibrarySync(page);
    return NextResponse.json({
      ok: true,
      count: result.body?.count || 0,
      currentPage: result.body?.current_page || page,
      persistedTo: result.body?.persisted_to || "postgres"
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

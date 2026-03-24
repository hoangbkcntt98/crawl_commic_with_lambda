import { NextResponse } from "next/server";

import { triggerLibrarySync } from "@/lib/server/manga";

export async function POST() {
  try {
    const result = await triggerLibrarySync();
    return NextResponse.json({
      ok: true,
      count: result.body?.count || 0,
      persistedTo: result.body?.persisted_to || "postgres"
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

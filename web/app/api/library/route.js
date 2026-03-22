import { NextResponse } from "next/server";

import { getLibrary } from "@/lib/server/manga";

export async function GET() {
  try {
    const library = await getLibrary();
    return NextResponse.json(library);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

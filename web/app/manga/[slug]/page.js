import { ReaderClient } from "@/components/reader-client";
import { getReaderData } from "@/lib/server/manga";

export const dynamic = "force-dynamic";

export default async function MangaReaderPage({ params }) {
  const { slug } = await params;
  const data = await getReaderData(slug);

  return <ReaderClient item={data.item} manifest={data.manifest} slug={slug} />;
}

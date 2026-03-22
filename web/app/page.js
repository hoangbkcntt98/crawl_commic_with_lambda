/* eslint-disable @next/next/no-img-element */
import Link from "next/link";

import { DownloadButton } from "@/components/download-button";
import { LibraryActions } from "@/components/library-actions";
import { getLibrary, getMangaManifest } from "@/lib/server/manga";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const library = await getLibrary();

  const itemsWithStatus = await Promise.all(
    library.items.map(async (item) => {
      const manifest = await getMangaManifest(item.slug, item.title);
      return {
        ...item,
        downloaded: Boolean(manifest?.chapters?.length),
        manifest
      };
    })
  );

  return (
    <main className="library-page">
      <section className="hero">
        <div>
          <p className="eyebrow">MangaRW x Lambda x S3</p>
          <h1>{library.title || "MangaRW Library"}</h1>
          <p className="hero-copy">
            Dong bo danh sach truyện tu `browse`, trigger crawl theo tung title, va doc
            manifest da upload len S3 ngay trong Next.js.
          </p>
        </div>
        <LibraryActions />
      </section>

      <section className="library-meta">
        <span>{itemsWithStatus.length} titles</span>
        <span>{library.updated_at ? `Updated ${library.updated_at}` : "Chua co lan dong bo nao"}</span>
      </section>

      {!library.exists ? (
        <section className="empty-library">
          <h2>Chua co file links.json tren S3</h2>
          <p>
            Bam nut <strong>Tao / cap nhat links.json</strong> o phia tren de trigger
            action `list_browse_links_to_s3`. Sau khi Lambda chay xong, reload lai trang
            nay de xem danh sach truyen.
          </p>
        </section>
      ) : null}

      <section className="cards-grid">
        {itemsWithStatus.map((item) => (
          <article key={item.slug} className="manga-card">
            <div className="cover-wrap">
              {item.image_url ? <img src={item.image_url} alt={item.title} className="cover-image" /> : null}
              <div className={`status-pill ${item.downloaded ? "ready" : "idle"}`}>
                {item.downloaded ? "Ready" : "Not downloaded"}
              </div>
            </div>

            <div className="card-body">
              <h2>{item.title}</h2>
              <p className="card-link">{item.read_url}</p>

              <div className="card-actions">
                <Link href={`/manga/${item.slug}`} className="primary-link">
                  Read
                </Link>
                <DownloadButton slug={item.slug} />
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

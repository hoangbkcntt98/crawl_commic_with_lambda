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
        progress: manifest?.progress || {
          status: "idle",
          expected_chapters: 0,
          completed_chapters: 0
        },
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
            Trang nay chi hien nhung truyen ban chu dong nhap URL. Moi lan them se crawl
            metadata cua truyen do, dua vao list, roi ban co the bam Download hoac Read.
          </p>
        </div>
        <LibraryActions />
      </section>

      <section className="library-meta">
        <span>{itemsWithStatus.length} titles</span>
        <span>{library.updated_at ? `Updated ${library.updated_at}` : "Chua co lan them nao"}</span>
      </section>

      {!library.exists ? (
        <section className="empty-library">
          <h2>List truyen dang trong</h2>
          <p>
            Nhap mot duong dan MangaRW o phia tren, sau do bam <strong>Crawl va them vao
            list</strong>. Trang chu se chi hien nhung truyen ban da chu dong them.
          </p>
        </section>
      ) : null}

      <section className="cards-grid">
        {itemsWithStatus.map((item) => (
          <article key={item.slug} className="manga-card">
            <div className="cover-wrap">
              {item.image_url ? <img src={item.image_url} alt={item.title} className="cover-image" /> : null}
              <div
                className={`status-pill ${
                  item.progress.status === "downloading"
                    ? "downloading"
                    : item.downloaded
                      ? "ready"
                      : "idle"
                }`}
              >
                {item.progress.status === "downloading"
                  ? "Downloading"
                  : item.downloaded
                    ? "Ready"
                    : "Not downloaded"}
              </div>
            </div>

            <div className="card-body">
              <h2>{item.title}</h2>
              <p className="card-link">{item.read_url}</p>

              <div className="card-actions">
                <Link href={`/manga/${item.slug}`} className="primary-link">
                  Read
                </Link>
                <DownloadButton slug={item.slug} initialProgress={item.progress} />
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

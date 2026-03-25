/* eslint-disable @next/next/no-img-element */
import Link from "next/link";

import { DownloadButton } from "@/components/download-button";
import { LibraryActions } from "@/components/library-actions";
import { MAX_PAGES } from "@/lib/config";
import { getLibrary, getMangaManifest } from "@/lib/server/manga";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }) {
  const params = await searchParams;
  const currentPage = Math.min(
    Math.max(Number(params?.page || 1) || 1, 1),
    Math.max(MAX_PAGES, 1)
  );
  const library = await getLibrary();
  const pageMatches = Number(library.current_page || 1) === currentPage;
  const visibleItems = pageMatches ? library.items : [];

  const itemsWithStatus = await Promise.all(
    visibleItems.map(async (item) => {
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
            Dong bo danh sach truyện tu `browse`, trigger crawl theo tung title, va doc
            manifest da upload len S3 ngay trong Next.js.
          </p>
        </div>
        <LibraryActions currentPage={currentPage} />
      </section>

      <section className="library-meta">
        <span>{itemsWithStatus.length} titles</span>
        <span>Page {currentPage}</span>
        <span>{library.updated_at ? `Updated ${library.updated_at}` : "Chua co lan dong bo nao"}</span>
      </section>

      <section className="pagination-bar">
        {Array.from({ length: Math.max(MAX_PAGES, 1) }, (_, index) => {
          const page = index + 1;
          const isActive = page === currentPage;
          return (
            <Link
              key={page}
              href={`/?page=${page}`}
              className={`pagination-link ${isActive ? "active" : ""}`}
            >
              {page}
            </Link>
          );
        })}
      </section>

      {!pageMatches || !library.exists ? (
        <section className="empty-library">
          <h2>Chua co du lieu truyện cho page {currentPage}</h2>
          <p>
            Bam nut <strong>Dong bo danh sach truyện</strong> o phia tren de crawl danh
            sach tu MangaRW va luu metadata vao database cho page nay. Sau khi xong,
            reload lai trang nay de xem thu vien.
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

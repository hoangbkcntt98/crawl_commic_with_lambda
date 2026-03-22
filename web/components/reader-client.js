/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function ReaderEmpty({ title, slug }) {
  return (
    <div className="reader-empty">
      <h2>{title}</h2>
      <p>Truyen nay chua co manifest tren S3. Hay bam Download tu trang danh sach truoc.</p>
      <Link href="/" className="ghost-link">
        Quay lai thu vien
      </Link>
      <Link href={`/api/manga/${slug}/download`} className="ghost-link">
        API download
      </Link>
    </div>
  );
}

export function ReaderClient({ item, manifest, slug }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    setCurrentIndex(0);
  }, [manifest?.updated_at]);

  if (!manifest || !Array.isArray(manifest.chapters) || manifest.chapters.length === 0) {
    return <ReaderEmpty title={item.title} slug={slug} />;
  }

  const chapter = manifest.chapters[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < manifest.chapters.length - 1;

  return (
    <div className="reader-page">
      <div className="reader-topbar">
        <div>
          <Link href="/" className="ghost-link">
            Thu vien
          </Link>
          <h1>{item.title}</h1>
          <p>
            {manifest.chapters.length} chapters
            {manifest.updated_at ? ` • Updated ${manifest.updated_at}` : ""}
          </p>
        </div>

        <div className="reader-controls">
          <button onClick={() => hasPrev && setCurrentIndex(currentIndex - 1)} disabled={!hasPrev}>
            Prev
          </button>
          <select
            value={currentIndex}
            onChange={(event) => setCurrentIndex(Number(event.target.value))}
          >
            {manifest.chapters.map((entry, index) => (
              <option key={entry.name} value={index}>
                {entry.name}
              </option>
            ))}
          </select>
          <button onClick={() => hasNext && setCurrentIndex(currentIndex + 1)} disabled={!hasNext}>
            Next
          </button>
        </div>
      </div>

      <div className="reader-status">
        <span>{chapter.name}</span>
        <span>{chapter.count} pages</span>
      </div>

      <div className="pages-grid">
        {chapter.files.map((fileName, index) => (
          <img
            key={fileName}
            className="page-image"
            src={`${manifest.assetBaseUrl}/${chapter.name}/${fileName}`}
            alt={`${item.title} - ${chapter.name} - page ${index + 1}`}
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}

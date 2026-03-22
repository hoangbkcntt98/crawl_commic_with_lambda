/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

function ReaderEmpty({ title, slug, progress }) {
  return (
    <div className="reader-empty">
      <h2>{title}</h2>
      <p>
        {progress?.status === "downloading"
          ? `Dang tai du lieu. Completed chapters: ${progress.completed_chapters}/${progress.expected_chapters || "?"}.`
          : "Truyen nay chua co manifest tren S3. Hay bam Download tu trang danh sach truoc."}
      </p>
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
  const [liveManifest, setLiveManifest] = useState(manifest);
  const [currentIndex, setCurrentIndex] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    setCurrentIndex(0);
    setLiveManifest(manifest);
  }, [manifest?.updated_at, manifest]);

  useEffect(() => {
    const progressStatus = liveManifest?.progress?.status;
    if (progressStatus !== "downloading") {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return undefined;
    }

    async function pollManifest() {
      try {
        const response = await fetch(`/api/manga/${slug}`, { cache: "no-store" });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Khong the cap nhat reader.");
        }

        if (data.manifest) {
          setLiveManifest(data.manifest);
        }
      } catch (error) {
        console.error(error);
      }
    }

    pollManifest();
    timerRef.current = setInterval(pollManifest, 5000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [liveManifest?.progress?.status, slug]);

  if (!liveManifest || !Array.isArray(liveManifest.chapters) || liveManifest.chapters.length === 0) {
    return <ReaderEmpty title={item.title} slug={slug} progress={liveManifest?.progress} />;
  }

  const safeIndex = Math.min(currentIndex, liveManifest.chapters.length - 1);
  const chapter = liveManifest.chapters[safeIndex];
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < liveManifest.chapters.length - 1;

  return (
    <div className="reader-page">
      <div className="reader-topbar">
        <div>
          <Link href="/" className="ghost-link">
            Thu vien
          </Link>
          <h1>{item.title}</h1>
          <p>
            {liveManifest.chapters.length} chapters
            {liveManifest.updated_at ? ` • Updated ${liveManifest.updated_at}` : ""}
          </p>
        </div>

        <div className="reader-controls">
          <button onClick={() => hasPrev && setCurrentIndex(safeIndex - 1)} disabled={!hasPrev}>
            Prev
          </button>
          <select
            value={safeIndex}
            onChange={(event) => setCurrentIndex(Number(event.target.value))}
          >
            {liveManifest.chapters.map((entry, index) => (
              <option key={entry.name} value={index}>
                {entry.name}
              </option>
            ))}
          </select>
          <button onClick={() => hasNext && setCurrentIndex(safeIndex + 1)} disabled={!hasNext}>
            Next
          </button>
        </div>
      </div>

      {liveManifest?.progress?.status === "downloading" ? (
        <div className="reader-progress-banner">
          <strong>Downloading...</strong>
          <span>
            Completed chapters: {liveManifest.progress.completed_chapters}/
            {liveManifest.progress.expected_chapters || "?"}
          </span>
        </div>
      ) : null}

      <div className="reader-status">
        <span>{chapter.name}</span>
        <span>{chapter.count} pages</span>
      </div>

      <div className="pages-grid">
        {chapter.files.map((fileName, index) => (
          <img
            key={fileName}
            className="page-image"
            src={`${liveManifest.assetBaseUrl}/${chapter.name}/${fileName}`}
            alt={`${item.title} - ${chapter.name} - page ${index + 1}`}
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}

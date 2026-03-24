"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

export function DownloadButton({ slug, initialProgress }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(
    initialProgress || {
      status: "idle",
      expected_chapters: 0,
      completed_chapters: 0
    }
  );

  useEffect(() => {
    setProgress(
      initialProgress || {
        status: "idle",
        expected_chapters: 0,
        completed_chapters: 0
      }
    );
  }, [initialProgress]);

  async function handleLoadProgress() {
    setIsLoadingProgress(true);
    setMessage("");

    try {
      const response = await fetch(`/api/manga/${slug}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Khong the cap nhat tien do.");
      }

      const nextProgress = data.progress || {
        status: "idle",
        expected_chapters: 0,
        completed_chapters: 0
      };
      setProgress(nextProgress);

      if (nextProgress.status === "completed") {
        setMessage("Download hoan tat.");
      } else {
        setMessage("Da load tien do moi nhat.");
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsLoadingProgress(false);
    }
  }

  async function handleDownload() {
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`/api/manga/${slug}/download`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Khong the bat dau crawl.");
      }

      const chapterCount = Number(data?.result?.chapter_count || 0);
      setProgress({
        status: "downloading",
        expected_chapters: chapterCount,
        completed_chapters: progress.completed_chapters || 0
      });
      setMessage(data.message || "Da gui yeu cau download.");
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="download-action">
      <button
        className="secondary-button"
        onClick={handleDownload}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Dang gui..." : progress.status === "downloading" ? "Downloading..." : "Download"}
      </button>
      <button
        className="secondary-button ghost-button"
        onClick={handleLoadProgress}
        disabled={isLoadingProgress}
      >
        {isLoadingProgress ? "Dang load..." : "Load progress"}
      </button>
      {progress.expected_chapters > 0 ? (
        <p className="progress-text">
          Completed chapters: {progress.completed_chapters}/{progress.expected_chapters}
        </p>
      ) : null}
      {message ? <p className="card-message">{message}</p> : null}
    </div>
  );
}

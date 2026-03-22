"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

export function DownloadButton({ slug }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

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
      <button className="secondary-button" onClick={handleDownload} disabled={isSubmitting}>
        {isSubmitting ? "Dang gui..." : "Download"}
      </button>
      {message ? <p className="card-message">{message}</p> : null}
    </div>
  );
}

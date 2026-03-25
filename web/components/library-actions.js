"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

export function LibraryActions({ currentPage }) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSync() {
    setIsSyncing(true);
    setMessage("");

    try {
      const response = await fetch("/api/library/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ page: currentPage })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Khong the dong bo danh sach.");
      }

      setMessage(`Da cap nhat ${data.count || 0} truyen cho page ${data.currentPage || currentPage}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="hero-actions">
      <button className="primary-button" onClick={handleSync} disabled={isSyncing}>
        {isSyncing ? "Dang dong bo database..." : `Dong bo danh sach truyện page ${currentPage}`}
      </button>
      {message ? <p className="action-message">{message}</p> : null}
    </div>
  );
}

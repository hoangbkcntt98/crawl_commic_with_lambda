"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

export function LibraryActions() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/library/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Khong the them truyen vao list.");
      }

      setMessage(`Da them "${data.item?.title || "truyen"}" vao list, tim thay ${data.chapterCount || 0} chapters.`);
      setUrl("");
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
    <form className="hero-actions" onSubmit={handleSubmit}>
      <label className="input-label" htmlFor="manga-url">
        Nhap URL truyen MangaRW
      </label>
      <input
        id="manga-url"
        className="url-input"
        type="url"
        inputMode="url"
        placeholder="https://mangarw.com/read?id=9241"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        required
      />
      <button className="primary-button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Dang crawl metadata..." : "Crawl va them vao list"}
      </button>
      {message ? <p className="action-message">{message}</p> : null}
    </form>
  );
}

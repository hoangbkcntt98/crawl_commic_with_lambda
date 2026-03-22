import "./globals.css";

export const metadata = {
  title: "MangaRW Library",
  description: "Browse, download, and read MangaRW titles via Lambda + S3."
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}

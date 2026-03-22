# crawl_commic_with_lambda

## Next.js app

Frontend moi nam trong `web/`.

1. Copy `web/.env.example` thanh `web/.env.local`
2. Cai package:
   `cd web && npm.cmd install`
3. Chay local:
   `npm.cmd run dev`
4. Deploy Vercel voi Root Directory = `web`

### Flow chinh

- `POST /api/library/sync`: goi Lambda action `list_browse_links_to_s3` de cap nhat `links.json`
- `/`: hien list truyen tu `links.json` tren S3
- `POST /api/manga/[slug]/download`: goi Lambda action `upload_title_to_s3` de crawl tat ca chapter cua title do len S3
- `/manga/[slug]`: doc manifest rieng cua title va render anh tu S3

# crawl_commic_with_lambda

## Next.js app

Frontend moi nam trong `web/`.

1. Copy `web/.env.example` thanh `web/.env.local`
2. Cai package:
   `cd web && npm.cmd install`
3. Chay local:
   `npm.cmd run dev`
4. Deploy Vercel voi Root Directory = `web`

### Vercel env

Can them cac env server-side sau trong Vercel Project Settings > Environment Variables:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` neu ban dung temporary credentials
- `LAMBDA_FUNCTION_NAME`
- `S3_BUCKET`
- `S3_PREFIX`
- `BROWSE_URL`
- `BROWSE_SORT`
- `MAX_PAGES`
- `WAIT_SEC`
- `LIBRARY_S3_KEY`
- `DOWNLOAD_INVOCATION_TYPE`
- `MAX_IMAGES_PER_CHAPTER`
- `NEXT_PUBLIC_S3_PUBLIC_BASE_URL`

Luu y:

- Khong dat prefix `NEXT_PUBLIC_` cho `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
- Cac bien AWS chi duoc dung trong API routes/server code cua Next.js
- `NEXT_PUBLIC_S3_PUBLIC_BASE_URL` la bien public duy nhat de browser doc anh public tu S3

### Flow chinh

- `POST /api/library/sync`: goi Lambda action `list_browse_links_to_s3` de cap nhat `links.json`
- `/`: hien list truyen tu `links.json` tren S3
- `POST /api/manga/[slug]/download`: goi Lambda action `upload_title_to_s3` de crawl tat ca chapter cua title do len S3
- `/manga/[slug]`: doc manifest rieng cua title va render anh tu S3

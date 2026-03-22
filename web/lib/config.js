const required = (name, fallback = "") => process.env[name] || fallback;

export const AWS_REGION = required("AWS_REGION", "ap-northeast-1");
export const LAMBDA_FUNCTION_NAME = required("LAMBDA_FUNCTION_NAME", "selenium-lambda");
export const S3_BUCKET = required("S3_BUCKET");
export const S3_PREFIX = required("S3_PREFIX", "crawler-test").replace(/\/+$/, "");
export const BROWSE_URL = required("BROWSE_URL", "https://mangarw.com/browse");
export const WAIT_SEC = Number(required("WAIT_SEC", "6"));
export const MAX_PAGES = Number(required("MAX_PAGES", "1"));
export const BROWSE_SORT = required("BROWSE_SORT", "views_week");
export const LIBRARY_S3_KEY = required("LIBRARY_S3_KEY", `${S3_PREFIX}/links.json`);
export const DOWNLOAD_INVOCATION_TYPE = required("DOWNLOAD_INVOCATION_TYPE", "Event");
export const MAX_IMAGES_PER_CHAPTER = required("MAX_IMAGES_PER_CHAPTER", "");

export const publicS3BaseUrl =
  process.env.NEXT_PUBLIC_S3_PUBLIC_BASE_URL ||
  (S3_BUCKET ? `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com` : "");

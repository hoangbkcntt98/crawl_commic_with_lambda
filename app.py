import logging
import os
import re
import time
from typing import Any, Dict, List, Tuple
from urllib.parse import urljoin, urlparse

import boto3
import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import json
from datetime import datetime, timezone
import unicodedata
import psycopg


logger = logging.getLogger()
logger.setLevel(logging.INFO)

CHROME_BINARY = os.getenv("CHROME_BINARY", "/opt/chrome/chrome-linux64/chrome")
CHROMEDRIVER_BINARY = os.getenv(
    "CHROMEDRIVER_BINARY",
    "/opt/chromedriver/chromedriver-linux64/chromedriver",
)

DEFAULT_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "30"))
DEFAULT_WAIT_SEC = int(os.getenv("WAIT_SEC", "5"))
DEFAULT_TMP_DIR = "/tmp/crawler"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DEFAULT_MANIFEST_TABLE = os.getenv("MANGA_MANIFEST_TABLE", "").strip()
DEFAULT_LIBRARY_TABLE = os.getenv("MANGA_LIBRARY_TABLE", "manga_library").strip()

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
}

LAZY_ATTRS = ["src", "data-src", "data-original", "data-lazy-src", "data-cfsrc"]


def log_progress(event_name: str, **fields: Any) -> None:
    payload = {"event": event_name, **fields}
    logger.info(json.dumps(payload, ensure_ascii=False))


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def safe_name(name: str) -> str:
    name = unicodedata.normalize("NFKC", str(name or ""))
    name = re.sub(r"[\x00-\x1f\x7f]+", " ", name)
    name = re.sub(r"[\\/:*?\"<>|]+", "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name or "untitled"


def build_chapter_storage_name(chapter: Dict[str, Any]) -> str:
    chapter_num = int(chapter["num"])
    title = safe_name(chapter.get("title") or f"chapter_{chapter_num:03d}")
    return f"{chapter_num:03d} - {title}"


def build_driver() -> webdriver.Chrome:
    options = Options()
    options.binary_location = CHROME_BINARY

    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,1696")

    options.add_argument("--single-process")
    options.add_argument("--no-zygote")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-background-timer-throttling")
    options.add_argument("--disable-backgrounding-occluded-windows")
    options.add_argument("--disable-breakpad")
    options.add_argument("--disable-component-update")
    options.add_argument("--disable-domain-reliability")
    options.add_argument("--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process")
    options.add_argument("--disable-ipc-flooding-protection")
    options.add_argument("--disable-popup-blocking")
    options.add_argument("--disable-renderer-backgrounding")
    options.add_argument("--force-color-profile=srgb")
    options.add_argument("--metrics-recording-only")
    options.add_argument("--mute-audio")
    options.add_argument("--no-first-run")
    options.add_argument("--password-store=basic")
    options.add_argument("--use-mock-keychain")
    options.add_argument("--remote-debugging-port=9222")

    options.add_argument("--user-data-dir=/tmp/chrome-user-data")
    options.add_argument("--data-path=/tmp/chrome-data")
    options.add_argument("--disk-cache-dir=/tmp/chrome-cache")
    options.add_argument("--homedir=/tmp")
    options.add_argument("--crash-dumps-dir=/tmp")

    service = Service(
        executable_path=CHROMEDRIVER_BINARY,
        log_path="/tmp/chromedriver.log",
    )
    driver = webdriver.Chrome(service=service, options=options)
    driver.set_page_load_timeout(60)
    return driver


def pick_from_srcset(srcset: str | None) -> str | None:
    if not srcset:
        return None
    try:
        parts = [p.strip() for p in srcset.split(",") if p.strip()]
        return parts[-1].split()[0] if parts else None
    except Exception:
        return None


def get_catalog_dynamic(start_url: str, wait_sec: int = DEFAULT_WAIT_SEC) -> List[Dict[str, Any]]:
    driver = build_driver()
    try:
        log_progress("catalog.start", start_url=start_url, wait_sec=wait_sec)
        driver.get(start_url)

        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )
        time.sleep(wait_sec)

        html = driver.page_source
    finally:
        driver.quit()

    soup = BeautifulSoup(html, "html.parser")
    sel = soup.select_one("select#chapters")
    if not sel:
        raise RuntimeError("Không tìm thấy select#chapters trong HTML render.")

    options = sel.find_all("option")
    catalog: List[Dict[str, Any]] = []

    for idx, opt in enumerate(reversed(options), start=1):
        cid = (opt.get("value") or "").strip()
        if not cid:
            continue

        title = (opt.get_text() or "").strip()
        catalog.append(
            {
                "num": idx,
                "id": cid,
                "title": title,
                "url": f"https://mangarw.com/read?id={cid}",
            }
        )

    log_progress("catalog.done", start_url=start_url, count=len(catalog))
    return catalog


def get_image_urls_from_pagecontainer(chapter_url: str) -> List[str]:
    r = requests.get(chapter_url, headers=HEADERS, timeout=DEFAULT_TIMEOUT)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    containers = soup.select("div.page-container")

    def sort_key(tag: Any) -> int:
        raw = tag.get("data-index", "0")
        try:
            return int(raw)
        except ValueError:
            return 0

    containers.sort(key=sort_key)

    urls: List[str] = []

    for box in containers:
        img = box.select_one("img.page-img") or box.find("img")
        if not img:
            continue

        link = None

        if img.get("srcset"):
            link = pick_from_srcset(img.get("srcset"))

        if not link:
            for attr in LAZY_ATTRS:
                value = img.get(attr)
                if value and value.strip():
                    link = value.strip()
                    break

        if not link:
            continue

        if any(x in link.lower() for x in ["blank", "transparent", "base64"]):
            continue

        urls.append(urljoin(chapter_url, link))

    unique_urls: List[str] = []
    seen = set()
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique_urls.append(u)

    return unique_urls


def guess_ext_from_url_or_header(url: str, content_type: str | None) -> str:
    if content_type:
        ct = content_type.lower()
        if "jpeg" in ct or "jpg" in ct:
            return ".jpg"
        if "png" in ct:
            return ".png"
        if "webp" in ct:
            return ".webp"
        if "gif" in ct:
            return ".gif"

    path = urlparse(url).path.lower()
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        if path.endswith(ext):
            return ext
    return ".jpg"


def download_one_image(url: str, save_path: str, timeout: int = DEFAULT_TIMEOUT) -> Dict[str, Any]:
    with requests.get(url, headers=HEADERS, timeout=timeout, stream=True) as r:
        r.raise_for_status()
        ensure_dir(os.path.dirname(save_path))
        total = 0
        with open(save_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 128):
                if chunk:
                    f.write(chunk)
                    total += len(chunk)

        return {
            "path": save_path,
            "size": total,
            "content_type": r.headers.get("Content-Type", ""),
        }


def download_images_for_chapter(
    chapter_url: str,
    chapter_name: str | None = None,
    limit: int | None = None,
) -> Dict[str, Any]:
    log_progress(
        "chapter.download.start",
        chapter_url=chapter_url,
        chapter_name=chapter_name,
        limit=limit,
    )
    image_urls = get_image_urls_from_pagecontainer(chapter_url)
    if limit is not None:
        image_urls = image_urls[:limit]

    folder_name = safe_name(chapter_name or "chapter")
    out_dir = os.path.join(DEFAULT_TMP_DIR, folder_name)
    ensure_dir(out_dir)

    downloaded: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []

    for idx, image_url in enumerate(image_urls, start=1):
        try:
            head = requests.head(image_url, headers=HEADERS, timeout=15, allow_redirects=True)
            content_type = head.headers.get("Content-Type", "")
        except Exception:
            content_type = ""

        ext = guess_ext_from_url_or_header(image_url, content_type)
        if ext == ".jpeg":
            ext = ".jpg"

        filename = f"{idx:03d}{ext}"
        save_path = os.path.join(out_dir, filename)

        try:
            result = download_one_image(image_url, save_path)
            downloaded.append(
                {
                    "index": idx,
                    "url": image_url,
                    "path": result["path"],
                    "size": result["size"],
                }
            )
            if idx == 1 or idx == len(image_urls) or idx % 10 == 0:
                log_progress(
                    "chapter.download.progress",
                    chapter_name=folder_name,
                    downloaded=len(downloaded),
                    failed=len(failed),
                    total=len(image_urls),
                )
        except Exception as e:
            failed.append(
                {
                    "index": idx,
                    "url": image_url,
                    "error": str(e),
                }
            )

    log_progress(
        "chapter.download.done",
        chapter_name=folder_name,
        total=len(image_urls),
        downloaded_count=len(downloaded),
        failed_count=len(failed),
    )
    return {
        "chapter_url": chapter_url,
        "chapter_name": folder_name,
        "output_dir": out_dir,
        "image_count": len(image_urls),
        "downloaded_count": len(downloaded),
        "failed_count": len(failed),
        "downloaded": downloaded,
        "failed": failed,
    }


def upload_file_to_s3(local_path: str, bucket: str, key: str) -> Dict[str, Any]:
    s3 = boto3.client("s3")
    s3.upload_file(local_path, bucket, key)
    return {
        "bucket": bucket,
        "key": key,
        "local_path": local_path,
        "s3_uri": f"s3://{bucket}/{key}",
    }


def upload_urls_to_s3(
    chapter_url: str,
    bucket: str,
    prefix: str,
    chapter_name: str | None = None,
    limit: int | None = None,
) -> Dict[str, Any]:
    log_progress(
        "chapter.upload.start",
        chapter_url=chapter_url,
        chapter_name=chapter_name,
        bucket=bucket,
        prefix=prefix,
        limit=limit,
    )
    download_result = download_images_for_chapter(
        chapter_url=chapter_url,
        chapter_name=chapter_name,
        limit=limit,
    )

    uploaded: List[Dict[str, Any]] = []
    upload_failed: List[Dict[str, Any]] = []

    for item in download_result["downloaded"]:
        local_path = item["path"]
        filename = os.path.basename(local_path)
        key = f"{prefix.rstrip('/')}/{download_result['chapter_name']}/{filename}"

        try:
            r = upload_file_to_s3(local_path, bucket, key)
            uploaded.append(r)
            if len(uploaded) == 1 or len(uploaded) == len(download_result["downloaded"]) or len(uploaded) % 10 == 0:
                log_progress(
                    "chapter.upload.progress",
                    chapter_name=download_result["chapter_name"],
                    uploaded=len(uploaded),
                    upload_failed=len(upload_failed),
                    total=download_result["downloaded_count"],
                )
        except Exception as e:
            upload_failed.append(
                {
                    "path": local_path,
                    "key": key,
                    "error": str(e),
                }
            )

    log_progress(
        "chapter.upload.done",
        chapter_name=download_result["chapter_name"],
        downloaded_count=download_result["downloaded_count"],
        upload_count=len(uploaded),
        upload_failed_count=len(upload_failed),
    )
    return {
        "chapter_url": chapter_url,
        "chapter_name": download_result["chapter_name"],
        "bucket": bucket,
        "prefix": prefix,
        "downloaded_count": download_result["downloaded_count"],
        "upload_count": len(uploaded),
        "upload_failed_count": len(upload_failed),
        "uploaded": uploaded,
        "upload_failed": upload_failed,
        "download_failed": download_result["failed"],
    }


def filter_catalog_range(
    catalog: List[Dict[str, Any]],
    from_chapter: int | None = None,
    to_chapter: int | None = None,
    max_chapters: int | None = None,
) -> List[Dict[str, Any]]:
    items = catalog

    if from_chapter is not None:
        items = [x for x in items if int(x["num"]) >= from_chapter]

    if to_chapter is not None:
        items = [x for x in items if int(x["num"]) <= to_chapter]

    items = sorted(items, key=lambda x: int(x["num"]))

    if max_chapters is not None:
        items = items[:max_chapters]

    return items


def extract_chapter_num_from_name(name: str | None) -> int | None:
    if not name:
        return None
    match = re.match(r"^\s*(\d+)", str(name))
    if not match:
        return None
    return int(match.group(1))


def parse_json_if_needed(value: Any) -> Any:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return value
        if text[0] in "[{":
            try:
                return json.loads(text)
            except Exception:
                return value
    return value


def normalize_chapter_entry(chapter: Any) -> Dict[str, Any] | None:
    chapter = parse_json_if_needed(chapter)

    if isinstance(chapter, dict):
        files = parse_json_if_needed(chapter.get("files", []))
        if not isinstance(files, list):
            files = []
        return {
            "name": str(chapter.get("name") or ""),
            "count": int(chapter.get("count", 0) or 0),
            "files": [str(item) for item in files],
        }

    if isinstance(chapter, str) and chapter.strip():
        return {
            "name": chapter.strip(),
            "count": 0,
            "files": [],
        }

    return None


def normalize_manifest(manifest: Dict[str, Any]) -> Dict[str, Any]:
    chapters_raw = parse_json_if_needed(manifest.get("chapters", []))
    if not isinstance(chapters_raw, list):
        chapters_raw = []

    normalized_chapters: List[Dict[str, Any]] = []
    for chapter in chapters_raw:
        normalized = normalize_chapter_entry(chapter)
        if normalized:
            normalized_chapters.append(normalized)

    progress = parse_json_if_needed(manifest.get("progress", {}))
    if not isinstance(progress, dict):
        progress = {}

    manifest["chapters"] = normalized_chapters
    manifest["progress"] = progress
    return manifest


def get_resume_from_chapter(manifest: Dict[str, Any]) -> int | None:
    manifest = normalize_manifest(manifest)
    chapters = manifest.get("chapters", [])
    nums = [
        num
        for num in (extract_chapter_num_from_name(ch.get("name")) for ch in chapters)
        if num is not None
    ]
    return max(nums) if nums else None


def chapter_exists_in_manifest(manifest: Dict[str, Any], chapter_name: str) -> bool:
    manifest = normalize_manifest(manifest)
    for chapter in manifest.get("chapters", []):
        if chapter.get("name") == chapter_name and int(chapter.get("count", 0) or 0) > 0:
            return True
    return False


def chapter_prefix_exists_in_s3(bucket: str, prefix: str, chapter_name: str) -> bool:
    s3 = boto3.client("s3")
    chapter_prefix = f"{prefix.rstrip('/')}/{chapter_name}/"
    response = s3.list_objects_v2(Bucket=bucket, Prefix=chapter_prefix, MaxKeys=1)
    return bool(response.get("KeyCount", 0))


def list_chapter_files_from_s3(bucket: str, prefix: str, chapter_name: str) -> List[str]:
    s3 = boto3.client("s3")
    chapter_prefix = f"{prefix.rstrip('/')}/{chapter_name}/"
    continuation_token = None
    file_names: List[str] = []

    while True:
        kwargs: Dict[str, Any] = {
            "Bucket": bucket,
            "Prefix": chapter_prefix,
            "MaxKeys": 1000,
        }
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        response = s3.list_objects_v2(**kwargs)
        for item in response.get("Contents", []):
            key = item.get("Key", "")
            if not key or key.endswith("/"):
                continue
            file_names.append(key.split("/")[-1])

        if not response.get("IsTruncated"):
            break

        continuation_token = response.get("NextContinuationToken")

    return sorted(set(file_names))


def build_uploaded_items_from_s3(
    bucket: str,
    prefix: str,
    chapter_name: str,
) -> List[Dict[str, Any]]:
    file_names = list_chapter_files_from_s3(bucket, prefix, chapter_name)
    return [
        {
            "bucket": bucket,
            "key": f"{prefix.rstrip('/')}/{chapter_name}/{file_name}",
            "s3_uri": f"s3://{bucket}/{prefix.rstrip('/')}/{chapter_name}/{file_name}",
        }
        for file_name in file_names
    ]


def validate_sql_identifier(name: str, label: str) -> str:
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", str(name or "")):
        raise ValueError(f"Invalid {label}: {name}")
    return name


def get_pg_conn() -> psycopg.Connection:
    if not DATABASE_URL:
        raise ValueError("Missing DATABASE_URL environment variable.")
    return psycopg.connect(DATABASE_URL)


def ensure_manifest_table_exists(manifest_table: str) -> None:
    manifest_table = validate_sql_identifier(manifest_table, "manifest_table")
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                create table if not exists {manifest_table} (
                    manga_id text primary key,
                    title text,
                    storage_name text,
                    chapters jsonb not null default '[]'::jsonb,
                    progress jsonb not null default '{{}}'::jsonb,
                    updated_at timestamptz
                )
                """
            )
        conn.commit()


def load_manifest(
    bucket: str,
    key: str,
    manifest_table: str | None = None,
    manga_id: str | None = None,
) -> Dict[str, Any]:
    if manifest_table and manga_id:
        ensure_manifest_table_exists(manifest_table)
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    select title, storage_name, chapters, progress, updated_at
                    from {validate_sql_identifier(manifest_table, 'manifest_table')}
                    where manga_id = %s
                    limit 1
                    """,
                    (str(manga_id),),
                )
                row = cur.fetchone()

        if row:
            title, storage_name, chapters, progress, updated_at = row
            return normalize_manifest({
                "manga_id": str(manga_id),
                "title": title,
                "storage_name": storage_name,
                "chapters": chapters or [],
                "progress": progress or {},
                "updated_at": updated_at.isoformat() if updated_at else None,
            })

        return normalize_manifest({
            "manga_id": str(manga_id),
            "title": "Manga Viewer",
            "storage_name": None,
            "updated_at": None,
            "chapters": [],
            "progress": {
                "status": "idle",
                "expected_chapters": 0,
                "completed_chapters": 0,
            },
        })

    return normalize_manifest(load_manifest_from_s3(bucket, key))


def save_manifest(
    bucket: str,
    key: str,
    manifest: Dict[str, Any],
    manifest_table: str | None = None,
    manga_id: str | None = None,
) -> Dict[str, Any]:
    manifest = normalize_manifest(dict(manifest))
    if manifest_table and manga_id:
        ensure_manifest_table_exists(manifest_table)
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    insert into {validate_sql_identifier(manifest_table, 'manifest_table')}
                        (manga_id, title, storage_name, chapters, progress, updated_at)
                    values (%s, %s, %s, %s::jsonb, %s::jsonb, %s)
                    on conflict (manga_id) do update
                    set title = excluded.title,
                        storage_name = excluded.storage_name,
                        chapters = excluded.chapters,
                        progress = excluded.progress,
                        updated_at = excluded.updated_at
                    """,
                    (
                        str(manga_id),
                        manifest.get("title"),
                        manifest.get("storage_name"),
                        json.dumps(manifest.get("chapters", []), ensure_ascii=False),
                        json.dumps(manifest.get("progress", {}), ensure_ascii=False),
                        manifest.get("updated_at"),
                    ),
                )
            conn.commit()
        return {
            "database": "postgres",
            "table": manifest_table,
            "manga_id": str(manga_id),
        }

    return save_manifest_to_s3(bucket, key, manifest)


def upload_title_to_s3(
    start_url: str,
    bucket: str,
    prefix: str,
    manifest_key: str,
    manifest_table: str | None,
    manga_id: str | None,
    site_title: str,
    wait_sec: int = DEFAULT_WAIT_SEC,
    from_chapter: int | None = None,
    to_chapter: int | None = None,
    max_chapters: int | None = None,
    limit: int | None = None,
) -> Dict[str, Any]:
    log_progress(
        "title.upload.start",
        start_url=start_url,
        site_title=site_title,
        bucket=bucket,
        prefix=prefix,
        manifest_key=manifest_key,
        manifest_table=manifest_table,
        manga_id=manga_id,
    )
    catalog = get_catalog_dynamic(start_url=start_url, wait_sec=wait_sec)
    selected = filter_catalog_range(
        catalog=catalog,
        from_chapter=from_chapter,
        to_chapter=to_chapter,
        max_chapters=max_chapters,
    )

    manifest = load_manifest(bucket, manifest_key, manifest_table=manifest_table, manga_id=manga_id)
    resume_from_chapter = get_resume_from_chapter(manifest)
    if resume_from_chapter is not None:
        selected = [chapter for chapter in selected if int(chapter["num"]) >= resume_from_chapter]
        log_progress(
            "title.upload.resume",
            site_title=site_title,
            resume_from_chapter=resume_from_chapter,
            selected_count=len(selected),
            manifest_key=manifest_key,
        )
    else:
        log_progress(
            "title.upload.resume",
            site_title=site_title,
            resume_from_chapter=None,
            selected_count=len(selected),
            manifest_key=manifest_key,
        )

    uploaded_chapters: List[Dict[str, Any]] = []
    failed_chapters: List[Dict[str, Any]] = []
    skipped_chapters: List[Dict[str, Any]] = []
    restored_chapters: List[Dict[str, Any]] = []

    for chapter in selected:
        chapter_name = build_chapter_storage_name(chapter)
        chapter_num = int(chapter["num"])
        if chapter_exists_in_manifest(manifest, chapter_name):
            skipped_chapters.append(
                {
                    "num": chapter_num,
                    "title": chapter.get("title"),
                    "chapter_name": chapter_name,
                    "reason": "manifest_exists",
                }
            )
            log_progress(
                "title.upload.chapter.skipped",
                site_title=site_title,
                chapter_num=chapter_num,
                chapter_name=chapter_name,
                reason="manifest_exists",
            )
            continue

        if chapter_prefix_exists_in_s3(bucket, prefix, chapter_name):
            uploaded_items = build_uploaded_items_from_s3(bucket, prefix, chapter_name)
            if uploaded_items:
                manifest = upsert_chapter_in_manifest(
                    manifest=manifest,
                    chapter_name=chapter_name,
                    uploaded_items=uploaded_items,
                    title=site_title,
                )
                restored_chapters.append(
                    {
                        "num": chapter_num,
                        "title": chapter.get("title"),
                        "chapter_name": chapter_name,
                        "file_count": len(uploaded_items),
                    }
                )
                log_progress(
                    "title.upload.chapter.restored_from_s3",
                    site_title=site_title,
                    chapter_num=chapter_num,
                    chapter_name=chapter_name,
                    file_count=len(uploaded_items),
                )
            skipped_chapters.append(
                {
                    "num": chapter_num,
                    "title": chapter.get("title"),
                    "chapter_name": chapter_name,
                    "reason": "s3_prefix_exists",
                }
            )
            log_progress(
                "title.upload.chapter.skipped",
                site_title=site_title,
                chapter_num=chapter_num,
                chapter_name=chapter_name,
                reason="s3_prefix_exists",
            )
            continue

        try:
            log_progress(
                "title.upload.chapter.start",
                site_title=site_title,
                chapter_num=chapter_num,
                chapter_name=chapter_name,
            )
            result = upload_urls_to_s3(
                chapter_url=chapter["url"],
                bucket=bucket,
                prefix=prefix,
                chapter_name=chapter_name,
                limit=limit,
            )
            manifest = upsert_chapter_in_manifest(
                manifest=manifest,
                chapter_name=result["chapter_name"],
                uploaded_items=result["uploaded"],
                title=site_title,
            )
            uploaded_chapters.append(
                {
                    "num": chapter_num,
                    "title": chapter.get("title"),
                    "chapter_name": result["chapter_name"],
                    "upload_count": result["upload_count"],
                    "upload_failed_count": result["upload_failed_count"],
                    "downloaded_count": result["downloaded_count"],
                }
            )
            log_progress(
                "title.upload.chapter.done",
                site_title=site_title,
                chapter_num=chapter_num,
                chapter_name=result["chapter_name"],
                uploaded_count=result["upload_count"],
                manifest_chapter_count=len(manifest.get("chapters", [])),
            )
        except Exception as e:
            failed_chapters.append(
                {
                    "num": int(chapter["num"]),
                    "title": chapter.get("title"),
                    "chapter_name": chapter_name,
                    "error": str(e),
                }
            )
            log_progress(
                "title.upload.chapter.failed",
                site_title=site_title,
                chapter_num=chapter_num,
                chapter_name=chapter_name,
                error=str(e),
            )

    manifest_result = save_manifest(
        bucket,
        manifest_key,
        manifest,
        manifest_table=manifest_table,
        manga_id=manga_id,
    )
    log_progress(
        "title.upload.done",
        site_title=site_title,
        selected_count=len(selected),
        uploaded_count=len(uploaded_chapters),
        restored_count=len(restored_chapters),
        skipped_count=len(skipped_chapters),
        failed_count=len(failed_chapters),
        manifest_key=manifest_key,
    )
    return {
        "site_title": site_title,
        "start_url": start_url,
        "bucket": bucket,
        "prefix": prefix,
        "manifest": manifest_result,
        "catalog_count": len(catalog),
        "selected_count": len(selected),
        "uploaded_count": len(uploaded_chapters),
        "restored_count": len(restored_chapters),
        "skipped_count": len(skipped_chapters),
        "failed_count": len(failed_chapters),
        "resume_from_chapter": resume_from_chapter,
        "uploaded_chapters": uploaded_chapters,
        "restored_chapters": restored_chapters,
        "skipped_chapters": skipped_chapters,
        "failed_chapters": failed_chapters,
    }


def read_chromedriver_tail() -> str:
    try:
        with open("/tmp/chromedriver.log", "r", encoding="utf-8", errors="ignore") as f:
            return f.read()[-4000:]
    except Exception:
        return "No chromedriver log found."


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    action = event.get("action", "healthcheck")
    aws_request_id = getattr(context, "aws_request_id", None)
    log_progress("lambda.invoke", action=action, aws_request_id=aws_request_id)

    try:
        if action == "healthcheck":
            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "message": "Lambda Selenium container is ready.",
                    "chrome_binary": CHROME_BINARY,
                    "chromedriver_binary": CHROMEDRIVER_BINARY,
                },
            }

        if action == "fetch_title":
            url = event["url"]
            driver = build_driver()
            try:
                driver.get(url)
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located((By.TAG_NAME, "body"))
                )
                title = driver.title
                html_length = len(driver.page_source)
            finally:
                driver.quit()

            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    "url": url,
                    "title": title,
                    "html_length": html_length,
                },
            }
        if action == "list_chapters":
            start_url = event["start_url"]
            wait_sec = int(event.get("wait_sec", DEFAULT_WAIT_SEC))

            catalog = get_catalog_dynamic(start_url=start_url, wait_sec=wait_sec)

            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    "total": len(catalog),
                    "chapters": catalog
                }
            }
        if action == "get_catalog":
            start_url = event["start_url"]
            wait_sec = int(event.get("wait_sec", DEFAULT_WAIT_SEC))
            catalog = get_catalog_dynamic(start_url=start_url, wait_sec=wait_sec)

            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    "count": len(catalog),
                    "catalog": catalog,
                },
            }

        if action == "get_images":
            chapter_url = event["chapter_url"]
            image_urls = get_image_urls_from_pagecontainer(chapter_url)

            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    "count": len(image_urls),
                    "image_urls": image_urls[:100],
                },
            }

        if action == "download_images":
            chapter_url = event["chapter_url"]
            chapter_name = event.get("chapter_name", "chapter")
            limit = event.get("limit")
            limit = int(limit) if limit is not None else None

            result = download_images_for_chapter(
                chapter_url=chapter_url,
                chapter_name=chapter_name,
                limit=limit,
            )

            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    "chapter_name": result["chapter_name"],
                    "output_dir": result["output_dir"],
                    "image_count": result["image_count"],
                    "downloaded_count": result["downloaded_count"],
                    "failed_count": result["failed_count"],
                    "downloaded_preview": result["downloaded"][:10],
                    "failed_preview": result["failed"][:10],
                },
            }

        if action == "upload_to_s3":
            chapter_url = event["chapter_url"]
            bucket = event["bucket"]
            prefix = event.get("prefix", "crawler")
            chapter_name = event.get("chapter_name", "chapter")
            limit = event.get("limit")
            limit = int(limit) if limit is not None else None

            manifest_key = event.get("manifest_key", f"{prefix.rstrip('/')}/manifest.json")
            manifest_table = event.get("manifest_table", DEFAULT_MANIFEST_TABLE) or None
            manga_id = event.get("manga_id")
            site_title = event.get("site_title", "Manga Viewer")
            log_progress(
                "lambda.upload_to_s3.start",
                aws_request_id=aws_request_id,
                site_title=site_title,
                chapter_name=chapter_name,
                bucket=bucket,
                prefix=prefix,
                manifest_key=manifest_key,
                manifest_table=manifest_table,
                manga_id=manga_id,
            )

            manifest = load_manifest(
                bucket,
                manifest_key,
                manifest_table=manifest_table,
                manga_id=manga_id,
            )
            if chapter_exists_in_manifest(manifest, chapter_name):
                log_progress(
                    "lambda.upload_to_s3.skipped",
                    aws_request_id=aws_request_id,
                    site_title=site_title,
                    chapter_name=chapter_name,
                    reason="manifest_exists",
                )
                return {
                    "statusCode": 200,
                    "body": {
                        "ok": True,
                        "action": action,
                        "chapter_name": chapter_name,
                        "bucket": bucket,
                        "prefix": prefix,
                        "skipped": True,
                        "reason": "manifest_exists",
                        "manifest_chapter_count": len(manifest.get("chapters", [])),
                    },
                }

            if chapter_prefix_exists_in_s3(bucket, prefix, chapter_name):
                uploaded_items = build_uploaded_items_from_s3(bucket, prefix, chapter_name)
                if uploaded_items:
                    manifest = upsert_chapter_in_manifest(
                        manifest=manifest,
                        chapter_name=chapter_name,
                        uploaded_items=uploaded_items,
                        title=site_title,
                    )
                    manifest_result = save_manifest(
                        bucket,
                        manifest_key,
                        manifest,
                        manifest_table=manifest_table,
                        manga_id=manga_id,
                    )
                    log_progress(
                        "lambda.upload_to_s3.restored_from_s3",
                        aws_request_id=aws_request_id,
                        site_title=site_title,
                        chapter_name=chapter_name,
                        file_count=len(uploaded_items),
                        manifest_chapter_count=len(manifest.get("chapters", [])),
                    )
                else:
                    manifest_result = None

                log_progress(
                    "lambda.upload_to_s3.skipped",
                    aws_request_id=aws_request_id,
                    site_title=site_title,
                    chapter_name=chapter_name,
                    reason="s3_prefix_exists",
                )
                return {
                    "statusCode": 200,
                    "body": {
                        "ok": True,
                        "action": action,
                        "chapter_name": chapter_name,
                        "bucket": bucket,
                        "prefix": prefix,
                        "skipped": True,
                        "reason": "s3_prefix_exists",
                        "restored_from_s3": bool(uploaded_items),
                        "restored_file_count": len(uploaded_items),
                        "manifest": manifest_result,
                        "manifest_chapter_count": len(manifest.get("chapters", [])),
                    },
                }

            result = upload_urls_to_s3(
                chapter_url=chapter_url,
                bucket=bucket,
                prefix=prefix,
                chapter_name=chapter_name,
                limit=limit,
            )

            manifest = load_manifest(
                bucket,
                manifest_key,
                manifest_table=manifest_table,
                manga_id=manga_id,
            )
            manifest = upsert_chapter_in_manifest(
                manifest=manifest,
                chapter_name=result["chapter_name"],
                uploaded_items=result["uploaded"],
                title=site_title
            )
            manifest_result = save_manifest(
                bucket,
                manifest_key,
                manifest,
                manifest_table=manifest_table,
                manga_id=manga_id,
            )
            log_progress(
                "lambda.upload_to_s3.done",
                aws_request_id=aws_request_id,
                site_title=site_title,
                chapter_name=result["chapter_name"],
                upload_count=result["upload_count"],
                manifest_chapter_count=len(manifest["chapters"]),
            )

            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    "chapter_name": result["chapter_name"],
                    "bucket": result["bucket"],
                    "prefix": result["prefix"],
                    "downloaded_count": result["downloaded_count"],
                    "upload_count": result["upload_count"],
                    "upload_failed_count": result["upload_failed_count"],
                    "uploaded_preview": result["uploaded"][:10],
                    "manifest": manifest_result,
                    "manifest_chapter_count": len(manifest["chapters"]),
                    "upload_failed_preview": result["upload_failed"][:10],
                    "download_failed_preview": result["download_failed"][:10],
                },
            }

        if action == "upload_title_to_s3":
            start_url = event["start_url"]
            bucket = event["bucket"]
            prefix = event.get("prefix", "crawler")
            manifest_key = event.get("manifest_key", f"{prefix.rstrip('/')}/manifest.json")
            manifest_table = event.get("manifest_table", DEFAULT_MANIFEST_TABLE) or None
            manga_id = event.get("manga_id")
            site_title = event.get("site_title", "Manga Viewer")
            wait_sec = int(event.get("wait_sec", DEFAULT_WAIT_SEC))

            from_chapter = event.get("from_chapter")
            from_chapter = int(from_chapter) if from_chapter is not None else None

            to_chapter = event.get("to_chapter")
            to_chapter = int(to_chapter) if to_chapter is not None else None

            max_chapters = event.get("max_chapters")
            max_chapters = int(max_chapters) if max_chapters is not None else None

            limit = event.get("limit")
            limit = int(limit) if limit is not None else None

            result = upload_title_to_s3(
                start_url=start_url,
                bucket=bucket,
                prefix=prefix,
                manifest_key=manifest_key,
                manifest_table=manifest_table,
                manga_id=manga_id,
                site_title=site_title,
                wait_sec=wait_sec,
                from_chapter=from_chapter,
                to_chapter=to_chapter,
                max_chapters=max_chapters,
                limit=limit,
            )

            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    **result,
                },
            }


        if action == "list_browse_links":
            browse_url = event["browse_url"]
            wait_sec = int(event.get("wait_sec", DEFAULT_WAIT_SEC))
            max_pages = int(event.get("max_pages", 1))
            sort = event.get("sort", "views_week")
            result = list_browse_links(
                browse_url=browse_url,
                wait_sec=wait_sec,
                max_pages=max_pages,
                sort=sort,
            )
            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    **result,
                },
            }

        if action == "list_browse_links_to_s3":
            browse_url = event["browse_url"]
            bucket = event["bucket"]
            wait_sec = int(event.get("wait_sec", DEFAULT_WAIT_SEC))
            max_pages = int(event.get("max_pages", 1))
            sort = event.get("sort", "views_week")
            links_key = event.get("links_key", "crawler-test/links.json")
            html_key = event.get("html_key", "crawler-test/list.html")
            page_title = event.get("page_title", "Manga Links")
            result = crawl_browse_links_to_s3(
                browse_url=browse_url,
                bucket=bucket,
                links_key=links_key,
                html_key=html_key,
                wait_sec=wait_sec,
                max_pages=max_pages,
                sort=sort,
                page_title=page_title,
            )
            return {
                "statusCode": 200,
                "body": {
                    "ok": True,
                    "action": action,
                    **result,
                },
            }

        return {
            "statusCode": 400,
            "body": {
                "ok": False,
                "message": f"Unsupported action: {action}",
            },
        }

    except Exception as e:
        logger.exception("Lambda execution failed")
        return {
            "statusCode": 500,
            "body": {
                "ok": False,
                "error": str(e),
                "action": action,
                "chromedriver_log_tail": read_chromedriver_tail(),
            },
        }


def build_browse_page_url(browse_url: str, page: int = 1, sort: str | None = "views_week") -> str:
    base = browse_url.split("?")[0]
    params: List[str] = []
    if page > 1:
        params.append(f"page={page}")
    if sort:
        params.append(f"sort={sort}")
    if not params:
        return base
    return f"{base}?{'&'.join(params)}"


def extract_image_url_from_card(card: Any, page_url: str) -> str | None:
    img = card.select_one("img")
    if not img:
        return None

    for attr in ["src", "data-src", "data-original", "data-lazy-src", "srcset"]:
        value = img.get(attr)
        if not value:
            continue
        value = value.strip()
        if not value:
            continue
        if attr == "srcset":
            value = pick_from_srcset(value)
            if not value:
                continue
        if value.startswith("data:"):
            continue
        return urljoin(page_url, value)
    return None


def extract_title_from_card(card: Any) -> str:
    title_tag = card.select_one("h3") or card.select_one("a[title]")
    if title_tag:
        title = (title_tag.get("title") or title_tag.get_text() or "").strip()
        if title:
            return title

    first_link = card.select_one("a[href*='/manga/']") or card.select_one("a[href]")
    if first_link:
        title = (first_link.get("title") or first_link.get_text() or "").strip()
        if title:
            return title

    return "untitled"


def get_read_url_from_detail_page(driver: webdriver.Chrome, detail_url: str, wait_sec: int = DEFAULT_WAIT_SEC) -> str | None:
    driver.get(detail_url)
    WebDriverWait(driver, 20).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )
    time.sleep(wait_sec)

    candidates = [
        (By.CSS_SELECTOR, "a[href*='/read?id=']"),
        (By.XPATH, "//a[contains(@href, '/read?id=') and contains(normalize-space(.), '今すぐ読む')]"),
        (By.XPATH, "//span[contains(normalize-space(.), '今すぐ読む')]/ancestor::a[1]"),
    ]

    for by, selector in candidates:
        try:
            elements = driver.find_elements(by, selector)
            for el in elements:
                href = (el.get_attribute("href") or "").strip()
                if "/read?id=" in href:
                    return href
        except Exception:
            pass

    soup = BeautifulSoup(driver.page_source, "html.parser")
    for a in soup.select("a[href*='/read?id=']"):
        href = (a.get("href") or "").strip()
        if href:
            return urljoin(detail_url, href)

    return None


def list_browse_links(
    browse_url: str,
    wait_sec: int = DEFAULT_WAIT_SEC,
    max_pages: int = 1,
    sort: str | None = "views_week",
) -> Dict[str, Any]:
    driver = build_driver()
    items: List[Dict[str, Any]] = []
    seen_read_urls = set()

    try:
        for page in range(1, max_pages + 1):
            page_url = build_browse_page_url(browse_url, page=page, sort=sort)
            logger.info("Opening browse page=%s", page_url)
            driver.get(page_url)
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            time.sleep(wait_sec)

            soup = BeautifulSoup(driver.page_source, "html.parser")
            cards = soup.select("ul.grid > li") or soup.select("main ul li")

            for card in cards:
                detail_anchor = card.select_one("a[href*='/manga/']") or card.select_one("a[href]")
                if not detail_anchor:
                    continue

                detail_href = (detail_anchor.get("href") or "").strip()
                if not detail_href:
                    continue

                detail_url = urljoin(page_url, detail_href)
                image_url = extract_image_url_from_card(card, page_url)
                title = extract_title_from_card(card)

                try:
                    read_url = get_read_url_from_detail_page(driver, detail_url, wait_sec=wait_sec)
                except Exception as e:
                    logger.warning("Failed resolving read_url for %s: %s", detail_url, e)
                    read_url = None

                if not read_url or read_url in seen_read_urls:
                    continue

                seen_read_urls.add(read_url)
                items.append(
                    {
                        "title": title,
                        "detail_url": detail_url,
                        "read_url": read_url,
                        "image_url": image_url,
                    }
                )
    finally:
        driver.quit()

    return {
        "browse_url": browse_url,
        "max_pages": max_pages,
        "sort": sort,
        "count": len(items),
        "items": items,
        "pairs": [[item["read_url"], item["image_url"]] for item in items],
    }


def save_json_to_s3(bucket: str, key: str, payload: Any) -> Dict[str, Any]:
    s3 = boto3.client("s3")
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json; charset=utf-8",
        CacheControl="no-cache",
    )
    return {
        "bucket": bucket,
        "key": key,
        "s3_uri": f"s3://{bucket}/{key}",
    }


def save_text_to_s3(bucket: str, key: str, text: str, content_type: str = "text/html; charset=utf-8") -> Dict[str, Any]:
    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=text.encode("utf-8"),
        ContentType=content_type,
        CacheControl="no-cache",
    )
    return {
        "bucket": bucket,
        "key": key,
        "s3_uri": f"s3://{bucket}/{key}",
    }


def crawl_browse_links_to_s3(
    browse_url: str,
    bucket: str,
    links_key: str,
    html_key: str,
    wait_sec: int = DEFAULT_WAIT_SEC,
    max_pages: int = 1,
    sort: str | None = "views_week",
    page_title: str = "Manga Links",
) -> Dict[str, Any]:
    result = list_browse_links(
        browse_url=browse_url,
        wait_sec=wait_sec,
        max_pages=max_pages,
        sort=sort,
    )
    payload = {
        "title": page_title,
        "browse_url": browse_url,
        "sort": sort,
        "max_pages": max_pages,
        "count": result["count"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "items": result["items"],
        "pairs": result["pairs"],
    }
    json_result = save_json_to_s3(bucket, links_key, payload)
    links_public_url = f"https://{bucket}.s3.ap-northeast-1.amazonaws.com/{links_key}"
    return {
        "count": result["count"],
        "items_preview": result["items"][:10],
        "pairs_preview": result["pairs"][:10],
        "links_json": json_result,
        "links_json_public_url": links_public_url,
        "list_html_public_url": f"https://{bucket}.s3.ap-northeast-1.amazonaws.com/{html_key}",
    }

def load_manifest_from_s3(bucket: str, key: str) -> Dict[str, Any]:
    s3 = boto3.client("s3")
    try:
        r = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(r["Body"].read().decode("utf-8"))
    except s3.exceptions.NoSuchKey:
        return {
            "title": "Manga Viewer",
            "updated_at": None,
            "chapters": []
        }
    except Exception as e:
        # nếu file chưa tồn tại hoặc lỗi kiểu NoSuchKey từ ClientError
        if "NoSuchKey" in str(e):
            return {
                "title": "Manga Viewer",
                "updated_at": None,
                "chapters": []
            }
        raise


def save_manifest_to_s3(bucket: str, key: str, manifest: Dict[str, Any]) -> Dict[str, Any]:
    s3 = boto3.client("s3")
    body = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json; charset=utf-8",
        CacheControl="no-cache"
    )
    return {
        "bucket": bucket,
        "key": key,
        "s3_uri": f"s3://{bucket}/{key}"
    }


def upsert_chapter_in_manifest(
    manifest: Dict[str, Any],
    chapter_name: str,
    uploaded_items: List[Dict[str, Any]],
    title: str | None = None
) -> Dict[str, Any]:
    file_names = sorted([item["key"].split("/")[-1] for item in uploaded_items])

    chapter_obj = {
        "name": chapter_name,
        "count": len(file_names),
        "files": file_names
    }

    if title:
        manifest["title"] = title

    chapters = manifest.get("chapters", [])
    replaced = False

    for idx, ch in enumerate(chapters):
        if ch.get("name") == chapter_name:
            chapters[idx] = chapter_obj
            replaced = True
            break

    if not replaced:
        chapters.append(chapter_obj)

    chapters.sort(key=lambda x: x["name"])
    manifest["chapters"] = chapters
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    progress = manifest.get("progress") or {}
    expected_chapters = int(progress.get("expected_chapters", 0) or 0)
    completed_chapters = len(chapters)
    manifest["progress"] = {
        "status": (
            "completed"
            if expected_chapters > 0 and completed_chapters >= expected_chapters
            else "downloading"
            if expected_chapters > 0
            else "completed"
            if completed_chapters > 0
            else "idle"
        ),
        "expected_chapters": expected_chapters,
        "completed_chapters": completed_chapters,
    }
    log_progress(
        "manifest.upsert",
        title=manifest.get("title"),
        chapter_name=chapter_name,
        completed_chapters=completed_chapters,
        expected_chapters=expected_chapters,
        status=manifest["progress"]["status"],
    )

    return manifest

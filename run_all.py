import json
import os
import sys
import time
from typing import Any, Dict, List

from dotenv import load_dotenv
load_dotenv()

import boto3


REGION = os.getenv("AWS_REGION", "ap-northeast-1")
FUNCTION_NAME = os.getenv("LAMBDA_FUNCTION_NAME", "selenium-lambda")

START_URL = os.getenv("START_URL", "").strip()
BUCKET = os.getenv("S3_BUCKET", "").strip()
PREFIX = os.getenv("S3_PREFIX", "crawler-test").strip()
MANIFEST_KEY = os.getenv("MANIFEST_KEY", f"{PREFIX.rstrip('/')}/manifest.json").strip()
SITE_TITLE = os.getenv("SITE_TITLE", "Manga Viewer").strip()

WAIT_SEC = int(os.getenv("WAIT_SEC", "3"))
FROM_CHAPTER = int(os.getenv("FROM_CHAPTER", "1"))
TO_CHAPTER_RAW = os.getenv("TO_CHAPTER", "").strip()
MAX_CHAPTERS_RAW = os.getenv("MAX_CHAPTERS", "").strip()
MAX_IMAGES_PER_CHAPTER_RAW = os.getenv("MAX_IMAGES_PER_CHAPTER", "").strip()
INVOKE_SLEEP_SEC = float(os.getenv("INVOKE_SLEEP_SEC", "0.5"))

TO_CHAPTER = int(TO_CHAPTER_RAW) if TO_CHAPTER_RAW else None
MAX_CHAPTERS = int(MAX_CHAPTERS_RAW) if MAX_CHAPTERS_RAW else None
MAX_IMAGES_PER_CHAPTER = (
    int(MAX_IMAGES_PER_CHAPTER_RAW) if MAX_IMAGES_PER_CHAPTER_RAW else None
)


lambda_client = boto3.client("lambda", region_name=REGION)


def invoke_lambda(payload: Dict[str, Any]) -> Dict[str, Any]:
    response = lambda_client.invoke(
        FunctionName=FUNCTION_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode("utf-8"),
    )

    raw = response["Payload"].read().decode("utf-8")
    if not raw:
        raise RuntimeError("Lambda trả về body rỗng.")

    data = json.loads(raw)

    if "statusCode" not in data:
        raise RuntimeError(f"Lambda response không đúng format: {data}")

    body = data.get("body", {})
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            body = {"raw_body": body}

    if data["statusCode"] >= 400:
        raise RuntimeError(f"Lambda error: {json.dumps(body, ensure_ascii=False)}")

    return {
        "statusCode": data["statusCode"],
        "body": body,
    }


def list_all_chapters(start_url: str, wait_sec: int) -> List[Dict[str, Any]]:
    payload = {
        "action": "get_catalog",
        "start_url": start_url,
        "wait_sec": wait_sec,
    }
    result = invoke_lambda(payload)
    body = result["body"]

    chapters = body.get("catalog", [])
    if not isinstance(chapters, list):
        raise RuntimeError(f"catalog không hợp lệ: {body}")

    return chapters


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


def upload_one_chapter(chapter: Dict[str, Any]) -> Dict[str, Any]:
    chapter_num = int(chapter["num"])
    chapter_name = f"chapter_{chapter_num:03d}"

    payload = {
        "action": "upload_to_s3",
        "chapter_url": chapter["url"],
        "chapter_name": chapter_name,
        "bucket": BUCKET,
        "prefix": PREFIX,
        "manifest_key": MANIFEST_KEY,
        "site_title": SITE_TITLE,
    }

    if MAX_IMAGES_PER_CHAPTER is not None:
        payload["limit"] = MAX_IMAGES_PER_CHAPTER

    return invoke_lambda(payload)


def validate_env() -> None:
    missing = []
    if not START_URL:
        missing.append("START_URL")
    if not BUCKET:
        missing.append("S3_BUCKET")

    if missing:
        raise ValueError(f"Thiếu biến môi trường: {', '.join(missing)}")


def main() -> None:
    validate_env()

    print("=== RUN ALL VIA LAMBDA START ===")
    print(f"REGION={REGION}")
    print(f"FUNCTION_NAME={FUNCTION_NAME}")
    print(f"START_URL={START_URL}")
    print(f"BUCKET={BUCKET}")
    print(f"PREFIX={PREFIX}")
    print(f"MANIFEST_KEY={MANIFEST_KEY}")
    print(f"FROM_CHAPTER={FROM_CHAPTER}")
    print(f"TO_CHAPTER={TO_CHAPTER}")
    print(f"MAX_CHAPTERS={MAX_CHAPTERS}")
    print(f"MAX_IMAGES_PER_CHAPTER={MAX_IMAGES_PER_CHAPTER}")
    print()

    catalog = list_all_chapters(START_URL, WAIT_SEC)
    print(f"Total catalog chapters: {len(catalog)}")

    selected = filter_catalog_range(
        catalog=catalog,
        from_chapter=FROM_CHAPTER,
        to_chapter=TO_CHAPTER,
        max_chapters=MAX_CHAPTERS,
    )

    print(f"Selected chapters: {len(selected)}")
    print()

    success = 0
    failed = 0
    failures: List[Dict[str, Any]] = []

    for idx, chapter in enumerate(selected, start=1):
        chapter_num = int(chapter["num"])
        chapter_title = chapter.get("title", f"chapter_{chapter_num}")
        print(f"[{idx}/{len(selected)}] Chapter {chapter_num} - {chapter_title}")

        try:
            result = upload_one_chapter(chapter)
            body = result["body"]

            print(
                "  OK "
                f"uploaded={body.get('upload_count', 0)} "
                f"upload_failed={body.get('upload_failed_count', 0)} "
                f"downloaded={body.get('downloaded_count', 0)}"
            )

            success += 1

        except Exception as e:
            print(f"  FAILED {e}")
            failures.append(
                {
                    "num": chapter_num,
                    "title": chapter_title,
                    "error": str(e),
                }
            )
            failed += 1

        time.sleep(INVOKE_SLEEP_SEC)

    print()
    print("=== RUN ALL VIA LAMBDA DONE ===")
    print(f"success={success}")
    print(f"failed={failed}")

    if failures:
        print("\nFailed chapters:")
        for item in failures:
            print(f"- {item['num']}: {item['title']} :: {item['error']}")

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
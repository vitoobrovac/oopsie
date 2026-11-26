"""Run PaddleOCR's PP-OCRv5 models locally through RapidOCR."""

import argparse
import json
from functools import lru_cache
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parent
LANGUAGE_CODES = {"english": "en", "latin": "latin"}


def recognize(photo: Path, model: str) -> dict:
    return recognize_bytes(photo.read_bytes(), model)


@lru_cache(maxsize=2)
def load_reader(model: str):
    # Also support the lab's isolated dependency folder on this Windows workspace.
    local_dependencies = LAB / ".rapidocr-deps"
    if local_dependencies.is_dir() and str(local_dependencies) not in sys.path:
        sys.path.insert(0, str(local_dependencies))

    from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR
    import cv2

    cv2.setNumThreads(1)
    print(f"Loading PP-OCRv5 ({model})...", file=sys.stderr)
    return RapidOCR(params={
        "EngineConfig.onnxruntime.intra_op_num_threads": 1,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
        "Det.limit_type": "max",
        "Det.limit_side_len": 1600,
        "Det.engine_type": EngineType.ONNXRUNTIME,
        "Det.lang_type": "ch",
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Det.model_type": ModelType.MOBILE,
        "Rec.engine_type": EngineType.ONNXRUNTIME,
        "Rec.lang_type": LANGUAGE_CODES[model],
        "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Rec.model_type": ModelType.MOBILE,
        "Rec.rec_batch_num": 1,
        "Global.use_cls": False,
    })


def recognize_bytes(image: bytes, model: str = "english") -> dict:
    reader = load_reader(model)
    print("Reading the receipt...", file=sys.stderr)
    # Pass local bytes so this command never treats an input string as a URL.
    result = reader(image, use_det=True, use_cls=False, use_rec=True)
    lines = []
    if result.txts is not None:
        for text, score, box in zip(result.txts, result.scores, result.boxes, strict=True):
            lines.append({
                "text": text,
                "confidence": round(float(score) * 100, 2),
                "polygon": [[round(float(x), 2), round(float(y), 2)] for x, y in box],
            })

    return {"engine": f"ppocrv5-{model}", "text": "\n".join(line["text"] for line in lines), "lines": lines}


def recognize_line(image: bytes, model: str = "english") -> tuple[str, float]:
    result = load_reader(model)(image, use_det=False, use_cls=False, use_rec=True)
    if not result.txts:
        return "", 0.0
    return result.txts[0], float(result.scores[0]) * 100


def save_result(photo: Path, payload: dict) -> Path:
    directory = LAB / "results"
    directory.mkdir(exist_ok=True)
    attempt = 1
    while True:
        suffix = "" if attempt == 1 else f"-{attempt}"
        output = directory / f"{photo.stem}-{payload['engine']}{suffix}.json"
        try:
            with output.open("x", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            return output
        except FileExistsError:
            attempt += 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("photo", type=Path, help="Path to a local JPG or PNG")
    parser.add_argument("--model", choices=LANGUAGE_CODES, default="english",
                        help="Recognition model (default: english)")
    args = parser.parse_args()
    photo = args.photo
    if photo.suffix.lower() not in {".jpg", ".jpeg", ".png"} or not photo.is_file():
        parser.error("Choose an existing local JPG or PNG photo.")
    try:
        result = recognize(photo, args.model)
        output = save_result(photo, result)
    except ModuleNotFoundError as exc:
        print(f"{exc}. Install the comparison dependencies from requirements-rapidocr.txt.", file=sys.stderr)
        return 1
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"OCR failed: {exc}", file=sys.stderr)
        return 1

    print(f"Saved OCR result to: {output}")
    print(f"Text lines found: {len(result['lines'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

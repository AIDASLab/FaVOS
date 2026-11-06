#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
from tqdm.auto import tqdm


DATASET_ROOT = Path("data")
SPLITS = ("favos-20", "favos-40")
OUTPUT_DIR = Path("results/jf_v")
BOUND_TH = 0.008
WORKERS = min(8, os.cpu_count() or 1)


@dataclass(frozen=True)
class JNFVResult:
    j_v: float
    f_v: float
    jnf_v: float
    precision_v: float
    recall_v: float
    intersection_volume: int
    union_volume: int
    pred_boundary_voxels: int
    gt_boundary_voxels: int


@dataclass(frozen=True)
class ObjectResult:
    split: str
    video_id: str
    object_id: int
    num_frames: int
    j_v: float
    f_v: float
    jnf_v: float
    precision_v: float
    recall_v: float
    intersection_volume: int
    union_volume: int
    pred_boundary_voxels: int
    gt_boundary_voxels: int


@dataclass(frozen=True)
class VideoResult:
    split: str
    video_id: str
    num_objects: int
    num_frames: int
    j_v: float
    f_v: float
    jnf_v: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Evaluate J&F_v on FaVOS indexed-PNG predictions. "
            "The dataset is expected under data/."
        )
    )
    parser.add_argument(
        "--pred-root",
        type=Path,
        required=True,
        help="Prediction root. Accepts either <root>/Annotations/<video_id> or <root>/<video_id>.",
    )
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    return parser.parse_args()


def numeric_pngs(path: Path) -> list[Path]:
    return sorted(
        [p for p in path.glob("*.png") if p.is_file() and not p.name.startswith("._")],
        key=lambda p: int(p.stem),
    )


def load_label(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image, dtype=np.uint8)


def read_split(dataset_root: Path, split: str) -> list[str]:
    path = dataset_root / f"{split}.txt"
    if not path.is_file():
        raise FileNotFoundError(f"Missing split file: {path}")
    ids = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    return list(dict.fromkeys(video_id for video_id in ids if video_id and not video_id.startswith("#")))


def resolve_pred_root(pred_root: Path) -> Path:
    annotations = pred_root / "Annotations"
    return annotations if annotations.is_dir() else pred_root


def load_video(gt_dir: Path, pred_dir: Path) -> tuple[np.ndarray, np.ndarray]:
    gt_paths = numeric_pngs(gt_dir)
    pred_by_name = {p.name: p for p in numeric_pngs(pred_dir)}
    if not gt_paths:
        raise FileNotFoundError(f"No GT masks found in {gt_dir}")

    missing = [p.name for p in gt_paths if p.name not in pred_by_name]
    if missing:
        raise FileNotFoundError(f"Missing {len(missing)} prediction masks in {pred_dir}: {missing[:5]}")

    gt_paths = gt_paths[1:]
    if not gt_paths:
        raise ValueError(f"No evaluation frames found in {gt_dir}")

    gt = np.stack([load_label(path) for path in gt_paths], axis=0)
    pred = np.stack([load_label(pred_by_name[path.name]) for path in gt_paths], axis=0)
    if gt.shape != pred.shape:
        raise ValueError(f"Shape mismatch for {gt_dir.name}: GT {gt.shape}, pred {pred.shape}")
    return gt, pred


def as_bool_volume(volume: np.ndarray) -> np.ndarray:
    if volume.ndim != 3:
        raise ValueError(f"Expected (T,H,W), got {volume.shape}")
    return volume.astype(bool)


def mean_visible_area(volume: np.ndarray) -> float:
    areas = np.sum(volume, axis=(1, 2), dtype=np.int64)
    visible = areas[areas > 0]
    return float(np.mean(visible)) if visible.size else 0.0


def spatial_radius(shape_2d: tuple[int, int], object_area: float, bound_th: float) -> int:
    radius = bound_th if bound_th >= 1 else bound_th * np.linalg.norm(shape_2d)
    if object_area > 0:
        radius = min(radius, 0.1 * np.sqrt(object_area))
    return max(int(np.ceil(radius)), 0)


def boundary_volume(volume: np.ndarray) -> np.ndarray:
    volume = volume.astype(bool)
    boundary = np.zeros_like(volume, dtype=bool)
    for dt in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                if dt == 0 and dy == 0 and dx == 0:
                    continue
                src = (
                    slice(0, volume.shape[0] - dt),
                    slice(0, volume.shape[1] - dy),
                    slice(0, volume.shape[2] - dx),
                )
                dst = (
                    slice(dt, volume.shape[0]),
                    slice(dy, volume.shape[1]),
                    slice(dx, volume.shape[2]),
                )
                boundary[src] |= volume[src] ^ volume[dst]
    return boundary


def count_matches(source_boundary: np.ndarray, target_boundaries: np.ndarray, radius: int) -> int:
    if not np.any(source_boundary) or not np.any(target_boundaries):
        return 0
    matched = np.zeros_like(source_boundary, dtype=bool)
    for target in target_boundaries:
        if np.any(target):
            matched |= distance_transform_edt(~target) <= radius
    return int(np.sum(source_boundary & matched))


def compute_jnf_v(
    gt_volume: np.ndarray,
    pred_volume: np.ndarray,
) -> JNFVResult:
    gt = as_bool_volume(gt_volume)
    pred = as_bool_volume(pred_volume)
    if gt.shape != pred.shape:
        raise ValueError(f"Shape mismatch: GT {gt.shape}, pred {pred.shape}")

    intersections = np.sum(gt & pred, axis=(1, 2), dtype=np.int64)
    unions = np.sum(gt | pred, axis=(1, 2), dtype=np.int64)
    total_intersection = int(np.sum(intersections, dtype=np.int64))
    total_union = int(np.sum(unions, dtype=np.int64))
    if total_union == 0:
        j_v = 1.0
    else:
        nonempty = unions > 0
        j_v = float(np.sum((unions[nonempty] / total_union) * (intersections[nonempty] / unions[nonempty])))

    radius = spatial_radius(gt.shape[1:], mean_visible_area(gt), BOUND_TH)
    gt_boundary = boundary_volume(gt)
    pred_boundary = boundary_volume(pred)

    matched_pred = 0
    matched_gt = 0
    total_pred_boundary = 0
    total_gt_boundary = 0
    for t in range(gt.shape[0]):
        gt_t = gt_boundary[t]
        pred_t = pred_boundary[t]
        n_gt = int(np.sum(gt_t))
        n_pred = int(np.sum(pred_t))
        total_gt_boundary += n_gt
        total_pred_boundary += n_pred
        if n_gt:
            matched_gt += count_matches(gt_t, pred_boundary[t : t + 1], radius)
        if n_pred:
            matched_pred += count_matches(pred_t, gt_boundary[t : t + 1], radius)

    if total_pred_boundary == 0 and total_gt_boundary == 0:
        precision = 1.0
        recall = 1.0
    elif total_pred_boundary == 0:
        precision = 1.0
        recall = 0.0
    elif total_gt_boundary == 0:
        precision = 0.0
        recall = 1.0
    else:
        precision = float(matched_pred / total_pred_boundary)
        recall = float(matched_gt / total_gt_boundary)
    f_v = 0.0 if precision + recall == 0 else float(2.0 * precision * recall / (precision + recall))

    return JNFVResult(
        j_v=j_v,
        f_v=f_v,
        jnf_v=(j_v + f_v) / 2.0,
        precision_v=precision,
        recall_v=recall,
        intersection_volume=total_intersection,
        union_volume=total_union,
        pred_boundary_voxels=total_pred_boundary,
        gt_boundary_voxels=total_gt_boundary,
    )


def evaluate_video(task: tuple[str, Path, Path]) -> dict[str, object]:
    video_id, gt_root, pred_root = task
    try:
        gt, pred = load_video(gt_root / video_id, pred_root / video_id)
        object_ids = [int(v) for v in np.unique(gt) if int(v) != 0]
        if not object_ids:
            raise ValueError(f"No foreground objects in {gt_root / video_id}")

        objects: list[ObjectResult] = []
        for object_id in object_ids:
            pred_obj = pred == object_id
            result = compute_jnf_v(
                gt == object_id,
                pred_obj,
            )
            objects.append(
                ObjectResult(
                    split="all",
                    video_id=video_id,
                    object_id=object_id,
                    num_frames=int(gt.shape[0]),
                    **asdict(result),
                )
            )

        video = VideoResult(
            split="all",
            video_id=video_id,
            num_objects=len(objects),
            num_frames=int(gt.shape[0]),
            j_v=float(np.mean([row.j_v for row in objects])),
            f_v=float(np.mean([row.f_v for row in objects])),
            jnf_v=float(np.mean([row.jnf_v for row in objects])),
        )
        return {"video_id": video_id, "objects": objects, "video": video, "error": None}
    except Exception as exc:
        return {"video_id": video_id, "objects": [], "video": None, "error": {"video_id": video_id, "error": str(exc)}}


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def summarize(split: str, objects: list[ObjectResult], videos: list[VideoResult]) -> dict[str, object]:
    return {
        "split": split,
        "num_videos": len(videos),
        "num_objects": len(objects),
        "num_object_frames": int(sum(row.num_frames for row in objects)),
        "j_v": float(np.mean([row.j_v for row in objects])) if objects else 0.0,
        "f_v": float(np.mean([row.f_v for row in objects])) if objects else 0.0,
        "jnf_v": float(np.mean([row.jnf_v for row in objects])) if objects else 0.0,
        "per_video_j_v": float(np.mean([row.j_v for row in videos])) if videos else 0.0,
        "per_video_f_v": float(np.mean([row.f_v for row in videos])) if videos else 0.0,
        "per_video_jnf_v": float(np.mean([row.jnf_v for row in videos])) if videos else 0.0,
    }


def main() -> int:
    args = parse_args()
    dataset_root = DATASET_ROOT
    gt_root = dataset_root / "Annotations"
    pred_root = resolve_pred_root(args.pred_root)
    if not gt_root.is_dir():
        raise FileNotFoundError(f"Missing GT root: {gt_root}")
    if not pred_root.is_dir():
        raise FileNotFoundError(f"Missing prediction root: {pred_root}")

    splits = {split: read_split(dataset_root, split) for split in SPLITS}
    unique_ids = sorted({video_id for ids in splits.values() for video_id in ids})
    if not unique_ids:
        raise ValueError("No videos selected for evaluation.")

    tasks = [
        (
            video_id,
            gt_root,
            pred_root,
        )
        for video_id in unique_ids
    ]

    objects_by_video: dict[str, list[ObjectResult]] = {}
    videos_by_video: dict[str, VideoResult] = {}
    max_workers = min(max(WORKERS, 1), len(tasks))

    if max_workers == 1:
        iterator = tqdm(tasks, desc="Evaluating", unit="video")
        for task in iterator:
            result = evaluate_video(task)
            if result["error"] is not None:
                raise RuntimeError(f"Failed evaluating {result['video_id']}: {result['error']['error']}")
            objects_by_video[result["video_id"]] = result["objects"]
            videos_by_video[result["video_id"]] = result["video"]
    else:
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(evaluate_video, task) for task in tasks]
            iterator = as_completed(futures)
            iterator = tqdm(iterator, total=len(futures), desc="Evaluating", unit="video")
            for future in iterator:
                result = future.result()
                if result["error"] is not None:
                    raise RuntimeError(f"Failed evaluating {result['video_id']}: {result['error']['error']}")
                objects_by_video[result["video_id"]] = result["objects"]
                videos_by_video[result["video_id"]] = result["video"]

    all_objects: list[ObjectResult] = []
    all_videos: list[VideoResult] = []
    summaries: dict[str, dict[str, object]] = {}
    for split, ids in splits.items():
        split_objects: list[ObjectResult] = []
        split_videos: list[VideoResult] = []
        for video_id in ids:
            for row in objects_by_video.get(video_id, []):
                split_objects.append(ObjectResult(split=split, **{k: v for k, v in asdict(row).items() if k != "split"}))
            if video_id in videos_by_video:
                row = videos_by_video[video_id]
                split_videos.append(VideoResult(split=split, **{k: v for k, v in asdict(row).items() if k != "split"}))
        all_objects.extend(split_objects)
        all_videos.extend(split_videos)
        summaries[split] = summarize(split, split_objects, split_videos)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(args.output_dir / "per_object_jf_v.csv", [asdict(row) for row in all_objects])
    write_csv(args.output_dir / "per_video_jf_v.csv", [asdict(row) for row in all_videos])
    summary = {
        "splits": summaries,
    }
    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    for split, row in summaries.items():
        print(
            f"{split}: videos={row['num_videos']} objects={row['num_objects']} "
            f"Jv={row['j_v']:.6f} Fv={row['f_v']:.6f} J&F_v={row['jnf_v']:.6f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

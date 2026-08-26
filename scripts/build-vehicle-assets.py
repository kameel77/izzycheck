#!/usr/bin/env python3
"""
Idempotent asset processing script for IzzyCheck vehicle damage mockups.
Converts raw 4:3 images from github/assety/ into normalized 2:1 canvases (1280x640 WebP for Web, 900x450 JPEG for PDF).

Normalizes vehicle body width to exactly 1150 px on a 1280 px canvas (paste_x = 65 px),
and aligns wheels to a constant ground baseline (bottom margin = 40 px).
"""

import os
import sys
import json
import shutil
from PIL import Image, ImageChops

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    asset_dir = os.path.join(root_dir, "..", "assety")
    if not os.path.exists(asset_dir):
        asset_dir = os.path.join(root_dir, "github", "assety")
    if not os.path.exists(asset_dir):
        asset_dir = "/Users/kamiltonkowicz/Documents/Vault/projects/izzy-izzycheck/github/assety"

    web_out_dir = os.path.join(root_dir, "public", "vehicles", "stage")
    pdf_out_dir = os.path.join(root_dir, "public", "vehicles", "pdf")
    old_pdf_assets_dir = os.path.join(root_dir, "lib", "pdf", "assets")

    os.makedirs(web_out_dir, exist_ok=True)
    os.makedirs(pdf_out_dir, exist_ok=True)

    # Clean up old lib/pdf/assets if present
    if os.path.exists(old_pdf_assets_dir):
        shutil.rmtree(old_pdf_assets_dir, ignore_errors=True)

    files = [
        ("suv_front.png", "suv-rf3q"),
        ("suv_back.png", "suv-lr3q"),
        ("sedan_front.png", "sedan-rf3q"),
        ("sedan_back.png", "sedan-lr3q"),
        ("kombi_front.png", "kombi-rf3q"),
        ("kombi_back.png", "kombi-lr3q"),
        ("hatchback_front.png", "hatchback-rf3q"),
        ("hatchback_back.png", "hatchback-lr3q"),
    ]

    print(f"Processing vehicle assets from {asset_dir}...")
    metrics = {}

    target_body_width = 1150
    canvas_w, canvas_h = 1280, 640
    bottom_margin = 40
    paste_x = (canvas_w - target_body_width) // 2 # 65 px

    for src_name, target_prefix in files:
        src_path = os.path.join(asset_dir, src_name)
        if not os.path.exists(src_path):
            print(f"Error: {src_path} not found!", file=sys.stderr)
            continue

        im = Image.open(src_path).convert("RGB")

        # Trim white border with tolerance
        bg = Image.new("RGB", im.size, (254, 254, 254))
        diff = ImageChops.difference(im, bg)
        diff_gray = diff.convert("L")
        threshold = 8
        mask = diff_gray.point(lambda p: 255 if p > threshold else 0)
        bbox = mask.getbbox()
        if not bbox:
            bbox = (0, 0, im.width, im.height)

        cropped = im.crop(bbox)

        # Scale based on constant target body width (1150 px)
        ratio = target_body_width / cropped.width
        new_w = target_body_width
        new_h = int(cropped.height * ratio)
        resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)

        # Create 1280x640 canvas (exact 2:1 ratio) with clean white background
        canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
        paste_y = canvas_h - new_h - bottom_margin
        canvas.paste(resized, (paste_x, paste_y))

        # Save WebP for Web UI (quality 80)
        webp_path = os.path.join(web_out_dir, f"{target_prefix}.webp")
        canvas.save(webp_path, format="WEBP", quality=80)
        webp_size = os.path.getsize(webp_path)

        # Save JPEG for PDF in public/vehicles/pdf (900x450, quality 72)
        pdf_canvas = canvas.resize((900, 450), Image.Resampling.LANCZOS)
        jpg_path = os.path.join(pdf_out_dir, f"{target_prefix}.jpg")
        pdf_canvas.save(jpg_path, format="JPEG", quality=72)
        jpg_size = os.path.getsize(jpg_path)

        metrics[target_prefix] = {
            "src": src_name,
            "raw_size": list(im.size),
            "cropped_size": list(cropped.size),
            "ratio": cropped.width / cropped.height,
            "canvas_size": [canvas_w, canvas_h],
            "body_box_on_canvas": [paste_x, paste_y, paste_x + new_w, paste_y + new_h],
            "webp_kb": round(webp_size / 1024, 1),
            "jpeg_kb": round(jpg_size / 1024, 1),
        }

        print(f"✓ {src_name} -> {target_prefix} (body: {new_w}x{new_h}, WebP: {webp_size//1024} KB, JPEG: {jpg_size//1024} KB)")

    # Save metrics JSON
    metrics_path = os.path.join(web_out_dir, "metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)

    print("All vehicle assets processed and metrics saved successfully.")

if __name__ == "__main__":
    main()

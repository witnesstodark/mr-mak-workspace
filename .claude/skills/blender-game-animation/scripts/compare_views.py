"""Put concept-sheet views and model renders side by side for a visual match review.

Used by the concept match loop in references/agent-build-loop.md.
Needs Pillow (any Python with PIL installed). Prints one line per output, so an agent can
read the IoU and aspect ratios without opening the images.

  python compare_views.py --concept concept_sheet.png --crop 120,80,620,1000 \
      --render renders/front.png --label "front" --out compare/round_1_front.png [--overlay]

  --crop      x0,y0,x1,y1 box of one view on the concept sheet (pixels). Omit to use the whole image.
  --render    one or more renders of the same view; each is auto-trimmed to its subject.
  --overlay   also writes <out>_overlay.png: the render's silhouette (red) over the concept
              view's silhouette (cyan), both scaled to the same subject height and aligned on
              the ground line, so proportion and width differences show directly.
  --bg        background colour used to find the subject (default: sampled from the corners).

Render the model with a transparent film (scene.render.film_transparent = True, RGBA PNG) so
its mask comes from alpha; the concept view is masked by distance from its background colour.
Both images are trimmed to their subject's bounding box and scaled to the same height, so
the comparison is about shape and proportion, not framing.
"""

import argparse
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

H = 720


def corner_bg(img):
    w, h = img.size
    px = [img.getpixel(p) for p in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3))]
    return tuple(sum(c[i] for c in px) // 4 for i in range(3))


def mask_of(img, bg=None, tol=28):
    rgb = img.convert("RGB")
    bg = bg or corner_bg(rgb)
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg)).convert("L")
    return diff.point(lambda v: 255 if v > tol else 0)


def trim(img, bg=None):
    """Crop to the subject. A render with transparency (film_transparent) uses its alpha."""
    if img.mode == "RGBA" and img.getextrema()[3][0] < 250:
        m = img.getchannel("A").point(lambda v: 255 if v > 16 else 0)
        flat = Image.new("RGB", img.size, (232, 232, 232))
        flat.paste(img, mask=img.getchannel("A"))
        img = flat
    else:
        img = img.convert("RGB")
        m = mask_of(img, bg)
    box = m.getbbox() or (0, 0, *img.size)
    return img.crop(box), m.crop(box)


def fit_h(img, h=H):
    w = max(1, round(img.width * h / img.height))
    return img.resize((w, h), Image.LANCZOS)


def label(img, text):
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, img.width, 26), fill=(30, 30, 30))
    d.text((8, 7), text, fill=(240, 240, 240))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--concept", required=True)
    ap.add_argument("--crop")
    ap.add_argument("--render", nargs="+", required=True)
    ap.add_argument("--label", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--overlay", action="store_true")
    ap.add_argument("--bg")
    a = ap.parse_args()
    bg = tuple(int(a.bg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) if a.bg else None

    concept = Image.open(a.concept).convert("RGB")
    if a.crop:
        concept = concept.crop(tuple(int(v) for v in a.crop.split(",")))
    c_img, c_mask = trim(concept, bg)
    panels = [label(fit_h(c_img).copy(), f"concept {a.label}")]
    r_masks = []
    for i, path in enumerate(a.render):
        r_img, r_mask = trim(Image.open(path).convert("RGBA"))
        panels.append(label(fit_h(r_img).copy(), f"model {a.label} {os.path.basename(path)}"))
        r_masks.append(r_mask)

    gap = 16
    out = Image.new("RGB", (sum(p.width for p in panels) + gap * (len(panels) + 1), H + 2 * gap), (245, 245, 245))
    x = gap
    for p in panels:
        out.paste(p, (x, gap))
        x += p.width + gap
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    out.save(a.out)
    print("wrote", a.out, "concept aspect %.3f" % (c_img.width / c_img.height),
          "model aspect", ", ".join("%.3f" % (m.width / m.height) for m in r_masks))

    if a.overlay:
        cm, rm = fit_h(c_mask), fit_h(r_masks[0])
        w = max(cm.width, rm.width)
        canvas = Image.new("RGB", (w, H), (255, 255, 255))
        cyan = Image.new("RGB", (w, H), (0, 170, 200))
        red = Image.new("RGB", (w, H), (220, 40, 40))
        cpad = Image.new("L", (w, H), 0)
        cpad.paste(cm, ((w - cm.width) // 2, 0))
        rpad = Image.new("L", (w, H), 0)
        rpad.paste(rm, ((w - rm.width) // 2, 0))
        canvas = Image.composite(cyan, canvas, cpad.point(lambda v: 150 if v else 0))
        both = ImageChops.multiply(cpad, rpad)
        canvas = Image.composite(red, canvas, ImageChops.subtract(rpad, both))
        edge = rpad.filter(ImageFilter.FIND_EDGES)
        canvas = Image.composite(Image.new("RGB", (w, H), (120, 0, 0)), canvas, edge)
        ov = os.path.splitext(a.out)[0] + "_overlay.png"
        label(canvas, f"{a.label}: cyan = concept only/both, red = model only, dark red = model outline").save(ov)
        inter = sum(1 for v in both.getdata() if v)
        union = sum(1 for v in ImageChops.lighter(cpad, rpad).getdata() if v)
        print("wrote", ov, "silhouette IoU %.3f" % (inter / union if union else 0))


if __name__ == "__main__":
    main()

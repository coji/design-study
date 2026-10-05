# 2 枚の画像を比べる: 違う画素の割合と、差分の画像
import sys
from PIL import Image, ImageChops
a, b, out = sys.argv[1:4]
A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
w, h = max(A.width, B.width), max(A.height, B.height)
pad = lambda im: (lambda c: (c.paste(im, (0, 0)), c)[1])(Image.new('RGB', (w, h), (255, 0, 255)))
d = ImageChops.difference(pad(A), pad(B)).convert('L').point(lambda v: 255 if v > 24 else 0)
bad = d.histogram()[255] ; pct = 100 * bad / (w * h)
red = Image.new('RGB', (w, h), (255, 0, 0)); vis = Image.composite(red, pad(B).point(lambda v: 128 + v // 2), d); vis.save(out)
print(f'{pct:.2f}% differ | size {A.size} vs {B.size} | bbox {d.getbbox()}')

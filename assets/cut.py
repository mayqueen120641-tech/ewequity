"""스프라이트 시트를 낱개 PNG로 자른다.

배경이 흰색이고 마스코트도 흰색이라 임계값으로는 못 지운다.
가장자리에서 시작해 '배경과 이어진' 밝은 픽셀만 흘려 지우면
양 몸통 안쪽의 흰색은 갈색 외곽선에 막혀 살아남는다.
"""
from PIL import Image
from collections import deque
import numpy as np, sys

def strip_bg(im, tol=34):
    im = im.convert('RGBA')
    a = np.array(im)
    h, w = a.shape[:2]
    rgb = a[:, :, :3].astype(np.int16)
    # 배경 후보: 아주 밝고 무채색인 픽셀 (체크무늬 244/253 둘 다 포함)
    # 배경이 순백이 아니라 **따뜻한 크림색**(253,248,236)이라 무채색 조건을 좁게 잡으면
    # 스프라이트 주위에 흰 네모가 남는다. 채도 허용치를 넉넉히 준다.
    # 양의 몸통도 크림색이지만 갈색 외곽선에 막혀 가장자리에서 흘러들어오지 못한다.
    mn = rgb.min(axis=2); mx = rgb.max(axis=2)
    bright = (mn >= 255 - tol) & (mx - mn <= 30)
    if a[:, :, 3].min() < 255:            # 이미 알파가 있으면 그것도 배경으로 본다
        bright |= a[:, :, 3] < 16

    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bright[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bright[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and bright[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    a[:, :, 3] = np.where(seen, 0, a[:, :, 3])
    return Image.fromarray(a, 'RGBA')

def cells(im, cols, rows):
    w, h = im.size
    cw, ch = w // cols, h // rows
    for r in range(rows):
        for c in range(cols):
            yield im.crop((c*cw, r*ch, (c+1)*cw, (r+1)*ch))

def save(cell, path, box=300):
    bb = cell.getbbox()
    if not bb:
        return None
    cut = cell.crop(bb)
    cut.thumbnail((box, box), Image.LANCZOS)
    cut.save(path, optimize=True)
    return cut.size

src, cols, rows, names = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4].split(',')
im = strip_bg(Image.open(src))
for cell, name in zip(cells(im, cols, rows), names):
    sz = save(cell, name + '.png', 300)
    print('  %-18s %s' % (name + '.png', sz))

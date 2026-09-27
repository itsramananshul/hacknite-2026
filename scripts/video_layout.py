"""Pure bounded caption placement shared by every generated explanation."""
def place_caption(x, y, width, height, placed, bounds=(-6.65, -.75, -2.35, 2.05)):
    left, right, bottom, top = bounds
    if width > right-left or height > top-bottom:
        return None
    original_x, original_y = x, y
    x = max(left+width/2, min(right-width/2, x))
    y = max(bottom+height/2, min(top-height/2, y))
    # Search nearest free slots; never move a caption outside its diagram.
    candidates = [(x, y)]
    for row in range(1, 45):
        for sign in (-1, 1):
            cy = y+sign*row*(height+.12)
            for cx in (x, left+width/2, right-width/2):
                candidates.append((cx, cy))
    candidates.sort(key=lambda point: (point[0]-x)**2+(point[1]-y)**2)
    for cx, cy in candidates:
        if (cx-original_x)**2+(cy-original_y)**2 > .8**2:
            continue
        box = (cx-width/2, cx+width/2, cy-height/2, cy+height/2)
        if box[0]<left or box[1]>right or box[2]<bottom or box[3]>top:
            continue
        if any(box[0]<p[1]+.12 and box[1]>p[0]-.12 and box[2]<p[3]+.10 and box[3]>p[2]-.10 for p in placed):
            continue
        placed.append(box)
        return (cx, cy)
    return None


def diagram_bounds(projected, extents, visible, shapes):
    """Ignore decorative planes and invisible states when framing a diagram."""
    import numpy as np
    mask=visible.copy()
    non_planes=np.array([shape!="plane" for shape in shapes])
    if np.any(mask & non_planes): mask &= non_planes
    if not np.any(mask): return np.array([-1.,-1.]), np.array([1.,1.])
    return (projected-extents)[mask].min(axis=0), (projected+extents)[mask].max(axis=0)

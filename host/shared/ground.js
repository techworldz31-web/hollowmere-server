// Ground height (world z) at a point, from the map's corner height grid.
// Tiles are split into two triangles along the NW-SE diagonal, exactly like the
// ground mesh the renderer draws, so feet stay on the drawn ground.
export function groundAt(map, x, y, deck = true) {
  const H = map.height;
  if (!H) return 0;
  // walking over a bridge: its deck arches over the water
  if (deck && map.bridges) for (const b of map.bridges) {
    if (x >= b.x0 && x < b.x0 + b.w && y >= b.y0 && y < b.y0 + b.h) return b.deck * Math.sin(Math.PI * (x - b.x0) / b.w);
  }
  const W1 = map.w + 1;
  if (x < 0) x = 0; else if (x > map.w - 1e-4) x = map.w - 1e-4;
  if (y < 0) y = 0; else if (y > map.h - 1e-4) y = map.h - 1e-4;
  const tx = Math.floor(x), ty = Math.floor(y), fx = x - tx, fy = y - ty, i = ty * W1 + tx;
  const h00 = H[i], h10 = H[i + 1], h01 = H[i + W1], h11 = H[i + W1 + 1];
  return fx >= fy ? h00 + fx * (h10 - h00) + fy * (h11 - h10) : h00 + fy * (h01 - h00) + fx * (h11 - h01);
}

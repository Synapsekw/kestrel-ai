/**
 * A 4000 × 3000 test frame drawn once into a blob URL: a concrete-grey gradient, a 250 px grid
 * with coordinates, and a dark diagonal "crack", so zoom levels and the full-frame swap are visible.
 * (Data colours for a generated picture, not UI styling.)
 */
export async function makeLabFrame(width = 4000, height = 3000): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas is not available");
  const grad = g.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, "#565a61");
  grad.addColorStop(1, "#8b9097");
  g.fillStyle = grad;
  g.fillRect(0, 0, width, height);
  g.strokeStyle = "rgba(255,255,255,0.22)";
  g.lineWidth = 2;
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.font = "28px monospace";
  for (let x = 0; x <= width; x += 250) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, height);
    g.stroke();
    for (let y = 0; y < height; y += 250) g.fillText(`${x},${y}`, x + 8, y + 32);
  }
  for (let y = 0; y <= height; y += 250) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(width, y);
    g.stroke();
  }
  g.strokeStyle = "rgba(20,20,24,0.85)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(1200, 900);
  for (let i = 1; i <= 40; i++) g.lineTo(1200 + i * 40, 900 + i * 22 + ((i * 37) % 17) - 8);
  g.stroke();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9),
  );
  return URL.createObjectURL(blob);
}

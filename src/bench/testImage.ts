/** Draws a synthetic specimen photo (insect, label, scale bar) so the benchmark can run without a real image. */
export async function makeTestImage(width = 4000, height = 3000): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const u = Math.min(width, height) / 100;

  const bg = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.7);
  bg.addColorStop(0, '#f1ebdd');
  bg.addColorStop(1, '#cfc4ad');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Insect centred in the frame, so the default click (image centre) lands on it.
  const cx = width / 2;
  const cy = height / 2;
  ctx.strokeStyle = '#2b1a0e';
  ctx.lineCap = 'round';
  ctx.lineWidth = u * 0.9;
  for (const side of [-1, 1]) {
    for (const [dy, reach, bend] of [[-6, 20, -8], [2, 22, 2], [10, 20, 12]]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * 4 * u, cy + dy * u);
      ctx.lineTo(cx + side * reach * 0.6 * u, cy + (dy + bend * 0.3) * u);
      ctx.lineTo(cx + side * reach * u, cy + (dy + bend) * u);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx + side * 2 * u, cy - 20 * u);
    ctx.quadraticCurveTo(cx + side * 8 * u, cy - 30 * u, cx + side * 12 * u, cy - 34 * u);
    ctx.stroke();
  }
  const shell = ctx.createLinearGradient(cx - 10 * u, cy, cx + 10 * u, cy);
  shell.addColorStop(0, '#3a2412');
  shell.addColorStop(0.5, '#7a4a22');
  shell.addColorStop(1, '#3a2412');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4 * u, 9 * u, 15 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b1a0e';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 13 * u, 6 * u, 4.5 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - 19 * u, 3.5 * u, 3 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  // Specimen label.
  const lx = width * 0.08;
  const ly = height * 0.68;
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(lx, ly, 34 * u, 16 * u);
  ctx.fillStyle = '#222';
  for (let i = 0; i < 4; i++) ctx.fillRect(lx + 2.5 * u, ly + (3 + i * 3.2) * u, (28 - (i % 2) * 9) * u, 1.3 * u);

  // Scale bar.
  ctx.fillStyle = '#111';
  ctx.fillRect(width * 0.72, height * 0.88, 20 * u, 1.2 * u);
  for (let i = 0; i <= 10; i++) ctx.fillRect(width * 0.72 + i * 2 * u, height * 0.88 - (i % 5 ? 1 : 2) * u, 0.3 * u, (i % 5 ? 1 : 2) * u);

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return new File([blob], `imagoLabel-test-${width}x${height}.jpg`, { type: 'image/jpeg' });
}

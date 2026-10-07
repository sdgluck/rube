import { useMemo } from "react";
import qrcode from "qrcode-generator";
import styles from "./QrCode.module.css";

/**
 * A QR code as inline SVG — one `<path>` of dark modules, so it scales without
 * blurring and costs no image request. Error correction `M` survives a phone
 * camera at an angle across a room, which is how these get scanned.
 */
export default function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
    return { size: count, path: d };
  }, [value]);

  // A four-module quiet zone, which the QR spec requires for a reliable read.
  return (
    <svg className={styles.qr} viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label={label}>
      <rect className={styles.paper} x={-4} y={-4} width={size + 8} height={size + 8} />
      <path className={styles.ink} d={path} shapeRendering="crispEdges" />
    </svg>
  );
}

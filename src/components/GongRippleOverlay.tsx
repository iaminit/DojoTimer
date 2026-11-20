interface GongRippleOverlayProps {
  triggerKey: number;
  hex: string;
  rgb: string;
}

export function GongRippleOverlay({ triggerKey, hex, rgb }: GongRippleOverlayProps) {
  if (triggerKey <= 0) {
    return null;
  }

  return (
    <div
      key={triggerKey}
      className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center overflow-hidden"
      aria-hidden="true"
      data-testid="gong-ripple-overlay"
    >
      {/* Radial impact glow behind digits/circle */}
      <div
        className="gong-ripple-flash h-[min(78vw,78dvh)] w-[min(78vw,78dvh)]"
        style={{
          background: `radial-gradient(circle, rgba(${rgb}, 0.34) 0%, rgba(${rgb}, 0.12) 42%, transparent 72%)`,
        }}
      />

      {/* Wave 1: Primary impact shockwave */}
      <div
        className="gong-ripple-ring h-[min(65vw,65dvh)] w-[min(65vw,65dvh)]"
        style={{
          borderWidth: '3px',
          borderColor: hex,
          boxShadow: `0 0 28px rgba(${rgb}, 0.72), inset 0 0 18px rgba(255, 255, 255, 0.35)`,
          ['--wave-delay' as string]: '0ms',
          ['--wave-duration' as string]: '1750ms',
          ['--wave-end-scale' as string]: '2.85',
          ['--wave-start-opacity' as string]: '0.94',
          ['--wave-mid-opacity' as string]: '0.68',
        }}
      />

      {/* Wave 2: Bronze resonance ring */}
      <div
        className="gong-ripple-ring h-[min(65vw,65dvh)] w-[min(65vw,65dvh)]"
        style={{
          borderWidth: '2px',
          borderColor: `rgba(${rgb}, 0.85)`,
          boxShadow: `0 0 20px rgba(${rgb}, 0.55)`,
          ['--wave-delay' as string]: '170ms',
          ['--wave-duration' as string]: '1950ms',
          ['--wave-end-scale' as string]: '2.65',
          ['--wave-start-opacity' as string]: '0.72',
          ['--wave-mid-opacity' as string]: '0.48',
        }}
      />

      {/* Wave 3: Trailing harmonic wash */}
      <div
        className="gong-ripple-ring h-[min(65vw,65dvh)] w-[min(65vw,65dvh)]"
        style={{
          borderWidth: '1.5px',
          borderColor: `rgba(${rgb}, 0.62)`,
          boxShadow: `0 0 14px rgba(${rgb}, 0.4)`,
          ['--wave-delay' as string]: '360ms',
          ['--wave-duration' as string]: '2150ms',
          ['--wave-end-scale' as string]: '2.45',
          ['--wave-start-opacity' as string]: '0.52',
          ['--wave-mid-opacity' as string]: '0.32',
        }}
      />
    </div>
  );
}

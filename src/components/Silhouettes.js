// SVG silhouette definitions for the Robot and Human figures
// Both use soft rounded shapes + SVG filter for a glowing "3D" look

export function RobotSVG({ glow = false }) {
  return (
    <svg
      viewBox="0 0 120 220"
      width="120"
      height="220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <filter id="robot-glow" x="-40%" y="-20%" width="180%" height="140%">
          <feGaussianBlur stdDeviation={glow ? '6' : '3'} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="robot-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C9A84C" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#8B6FC5" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="robot-head" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E8C87A" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#9F7AEA" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      <g filter="url(#robot-glow)">
        {/* Antenna */}
        <line x1="60" y1="14" x2="60" y2="2" stroke="url(#robot-head)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="2" r="4" fill="#E8C87A" opacity="0.9" />

        {/* Head */}
        <rect x="28" y="14" width="64" height="52" rx="16" fill="url(#robot-head)" />
        {/* Eyes */}
        <ellipse cx="44" cy="36" rx="9" ry="7" fill="#0F172A" opacity="0.7" />
        <ellipse cx="76" cy="36" rx="9" ry="7" fill="#0F172A" opacity="0.7" />
        <circle cx="44" cy="36" r="3.5" fill="#E8C87A" opacity="0.9" />
        <circle cx="76" cy="36" r="3.5" fill="#E8C87A" opacity="0.9" />
        {/* Mouth grill */}
        <rect x="40" y="53" width="40" height="5" rx="2.5" fill="#0F172A" opacity="0.35" />

        {/* Neck */}
        <rect x="50" y="66" width="20" height="12" rx="4" fill="url(#robot-body)" opacity="0.9" />

        {/* Body */}
        <rect x="22" y="78" width="76" height="72" rx="18" fill="url(#robot-body)" />
        {/* Chest detail */}
        <rect x="42" y="96" width="36" height="22" rx="8" fill="#0F172A" opacity="0.25" />
        <circle cx="60" cy="107" r="7" fill="#E8C87A" opacity="0.45" />

        {/* Left arm */}
        <rect x="6" y="80" width="16" height="58" rx="8" fill="url(#robot-body)" opacity="0.88" />
        <circle cx="14" cy="144" r="9" fill="url(#robot-head)" opacity="0.85" />

        {/* Right arm */}
        <rect x="98" y="80" width="16" height="58" rx="8" fill="url(#robot-body)" opacity="0.88" />
        <circle cx="106" cy="144" r="9" fill="url(#robot-head)" opacity="0.85" />

        {/* Hips */}
        <rect x="32" y="150" width="56" height="16" rx="8" fill="url(#robot-body)" opacity="0.9" />

        {/* Left leg */}
        <rect x="34" y="164" width="22" height="46" rx="10" fill="url(#robot-body)" opacity="0.85" />
        <rect x="30" y="202" width="30" height="14" rx="7" fill="url(#robot-head)" opacity="0.85" />

        {/* Right leg */}
        <rect x="64" y="164" width="22" height="46" rx="10" fill="url(#robot-body)" opacity="0.85" />
        <rect x="60" y="202" width="30" height="14" rx="7" fill="url(#robot-head)" opacity="0.85" />
      </g>
    </svg>
  );
}

export function HumanSVG({ glow = false }) {
  return (
    <svg
      viewBox="0 0 100 220"
      width="100"
      height="220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <filter id="human-glow" x="-40%" y="-20%" width="180%" height="140%">
          <feGaussianBlur stdDeviation={glow ? '5' : '2.5'} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="human-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D97C45" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#8B6FC5" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="human-skin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E8A87A" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#C9A84C" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      <g filter="url(#human-glow)">
        {/* Head */}
        <ellipse cx="50" cy="26" rx="24" ry="26" fill="url(#human-skin)" />
        {/* Hair */}
        <path d="M26 20 Q50 -2 74 20 Q72 10 50 6 Q28 10 26 20Z" fill="url(#human-body)" opacity="0.75" />

        {/* Neck */}
        <rect x="42" y="50" width="16" height="14" rx="6" fill="url(#human-skin)" opacity="0.9" />

        {/* Shoulders & torso */}
        <path d="M12 70 Q18 62 50 62 Q82 62 88 70 L88 140 Q82 148 50 148 Q18 148 12 140Z"
          fill="url(#human-body)" />
        {/* Heart area glow */}
        <ellipse cx="50" cy="100" rx="10" ry="10" fill="#E8C87A" opacity="0.18" />

        {/* Left arm */}
        <path d="M14 72 Q6 85 10 130 Q12 140 18 142" stroke="url(#human-body)" strokeWidth="16"
          strokeLinecap="round" fill="none" opacity="0.88" />
        {/* Left hand */}
        <ellipse cx="16" cy="148" rx="10" ry="8" fill="url(#human-skin)" opacity="0.9" />

        {/* Right arm */}
        <path d="M86 72 Q94 85 90 130 Q88 140 82 142" stroke="url(#human-body)" strokeWidth="16"
          strokeLinecap="round" fill="none" opacity="0.88" />
        {/* Right hand */}
        <ellipse cx="84" cy="148" rx="10" ry="8" fill="url(#human-skin)" opacity="0.9" />

        {/* Hips */}
        <rect x="22" y="146" width="56" height="18" rx="9" fill="url(#human-body)" opacity="0.9" />

        {/* Left leg */}
        <path d="M30 162 Q26 185 28 210" stroke="url(#human-body)" strokeWidth="18"
          strokeLinecap="round" fill="none" opacity="0.85" />
        <ellipse cx="28" cy="214" rx="16" ry="6" fill="url(#human-skin)" opacity="0.8" />

        {/* Right leg */}
        <path d="M70 162 Q74 185 72 210" stroke="url(#human-body)" strokeWidth="18"
          strokeLinecap="round" fill="none" opacity="0.85" />
        <ellipse cx="72" cy="214" rx="16" ry="6" fill="url(#human-skin)" opacity="0.8" />
      </g>
    </svg>
  );
}

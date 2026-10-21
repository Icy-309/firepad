// Minimal stroke icon set (24px grid, currentColor).
type P = { className?: string };
const base = (className = "h-5 w-5") => ({
  className,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconHome = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </svg>
);
export const IconPlus = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconSearch = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const IconMenu = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
export const IconSun = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
  </svg>
);
export const IconMoon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />
  </svg>
);
export const IconCopy = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);
export const IconCheck = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const IconExternal = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const IconChevronDown = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const IconWallet = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M3 7a2 2 0 0 1 2-2h13v4" />
    <path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" />
    <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" />
  </svg>
);
export const IconLogout = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11" />
  </svg>
);
export const IconSwap = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
  </svg>
);
export const IconX = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconGift = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3.5 8 4.5 9 8 12 8zM12 8s1.5-4.5 4-3.5S15 8 12 8z" />
  </svg>
);
export const IconBook = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M9 7h6" />
  </svg>
);
export const IconTrend = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />
  </svg>
);
export const IconClock = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const IconUsers = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
  </svg>
);
export const IconShield = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
export const IconBolt = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </svg>
);
export const IconImage = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);
export const IconGlobe = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
  </svg>
);
export const IconTelegram = ({ className }: P) => (
  <svg className={className ?? "h-4 w-4"} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M21.4 4.2 2.9 11.3c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.5-1.8zM8.6 14l9.5-6c.5-.3.9-.1.5.2l-7.8 7.1-.3 3.3z" />
  </svg>
);
export const IconX_Social = ({ className }: P) => (
  <svg className={className ?? "h-4 w-4"} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.2h1.7L7.4 4.73H5.58z" />
  </svg>
);

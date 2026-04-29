import { iconRootProps, type IconProps } from "./types";

/** Pin — used for "studio_job" timeline events (pinned comment automation). */
export function PinIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14V9.5a3 3 0 0 0-3-3h-1.5l-1-3h-3l-1 3H8a3 3 0 0 0-3 3z" />
    </svg>
  );
}

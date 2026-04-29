import { iconRootProps, type IconProps } from "./types";

export function VideoIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

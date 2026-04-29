import { iconRootProps, type IconProps } from "./types";

export function LeafIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <path d="M6 3 3 6c-1.5 1.5-1.5 4 0 5.5L11 19c1.5 1.5 4 1.5 5.5 0l3-3c1.5-1.5 1.5-4 0-5.5L11.5 3C10 1.5 7.5 1.5 6 3z" />
      <path d="M3 21l8-8" />
    </svg>
  );
}

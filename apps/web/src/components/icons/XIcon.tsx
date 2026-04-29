import { iconRootProps, type IconProps } from "./types";

export function XIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

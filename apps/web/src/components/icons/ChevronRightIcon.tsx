import { iconRootProps, type IconProps } from "./types";

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

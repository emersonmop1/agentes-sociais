import { iconRootProps, type IconProps } from "./types";

export function CheckIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

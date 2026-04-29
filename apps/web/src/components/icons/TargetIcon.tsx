import { iconRootProps, type IconProps } from "./types";

export function TargetIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

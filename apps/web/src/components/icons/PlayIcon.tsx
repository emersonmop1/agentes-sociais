import { iconRootProps, type IconProps } from "./types";

export function PlayIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <polygon
        points="5 3 19 12 5 21 5 3"
        fill={props.color ?? "currentColor"}
      />
    </svg>
  );
}

import { iconRootProps, type IconProps } from "./types";

/** Paint brush — used for "render_job" timeline events. */
export function BrushIcon(props: IconProps) {
  return (
    <svg {...iconRootProps(props)}>
      <path d="M9.06 11.9 7 14a3.5 3.5 0 1 0 4.94 4.94L14.05 17 9.06 11.9z" />
      <path d="m21.17 8.83-2.83-2.83-9.66 9.65 2.83 2.83 9.66-9.65z" />
      <path d="m17 4 3 3" />
    </svg>
  );
}

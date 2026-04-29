/**
 * Centralized icon registry. Every visual icon used across the app comes from
 * here so we never reach for emojis (📸, 🎬, etc.) in JSX.
 *
 * Each icon is a pure component: (props: IconProps) => JSX.Element. Stroke
 * width 2, rounded caps/joins. Default size 18, default color "currentColor"
 * so the icon inherits text color in most callsites.
 */

export type { IconProps } from "./types";

// Agent-specific icons (used by AgentAvatar over the gradient bg)
export { CameraIcon } from "./CameraIcon";
export { VideoIcon } from "./VideoIcon";
export { PenIcon } from "./PenIcon";
export { TargetIcon } from "./TargetIcon";
export { PlayIcon } from "./PlayIcon";
export { LeafIcon } from "./LeafIcon";

// Timeline kind icons (replace KIND_ICON emoji map)
export { MessageIcon } from "./MessageIcon";
export { BrainIcon } from "./BrainIcon";
export { BrushIcon } from "./BrushIcon";
export { UploadIcon } from "./UploadIcon";
export { ImageIcon } from "./ImageIcon";
export { PinIcon } from "./PinIcon";

// Action icons
export { PaperclipIcon } from "./PaperclipIcon";
export { SendIcon } from "./SendIcon";
export { CheckIcon } from "./CheckIcon";
export { XIcon } from "./XIcon";
export { ChevronRightIcon } from "./ChevronRightIcon";
export { GoogleIcon } from "./GoogleIcon";

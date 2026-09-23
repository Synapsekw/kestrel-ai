export type IconName =
  | "folder"
  | "images"
  | "label"
  | "datasets"
  | "train"
  | "detect"
  | "review"
  | "models"
  | "settings"
  | "home"
  | "search"
  | "chevron-down"
  | "chevron-right"
  | "check"
  | "x"
  | "plus"
  | "import"
  | "play"
  | "trash"
  | "undo"
  | "redo"
  | "fit"
  | "one-to-one"
  | "keyboard"
  | "grid"
  | "list"
  | "warning"
  | "info"
  | "external"
  | "spinner"
  | "arrow-left"
  | "arrow-right"
  | "hard-hat"
  | "jobs"
  | "refresh"
  | "eye"
  | "download"
  | "map"
  | "minus";

/** 24-unit line icons, one path each, drawn with the current colour. */
const PATHS: Record<IconName, string> = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  images:
    "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M16 9h.01",
  label: "M4 4h16v16H4zM8 9h8M8 13h5",
  datasets:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  train: "M4 20 20 4M4 12v8h8M14 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0z",
  detect:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3",
  review: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  models: "M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5",
  settings:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  home: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-right": "m9 6 6 6-6 6",
  check: "M5 13l4 4L19 7",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  import: "M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  play: "M7 5v14l12-7z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  "one-to-one": "M4 4h16v16H4zM9 9v6M13 9h2v6M13 15h4",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  warning: "M12 3 2 20h20L12 3zM12 10v4M12 17h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
  external: "M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6",
  spinner: "M12 3a9 9 0 0 1 9 9",
  "arrow-left": "M19 12H5M11 18l-6-6 6-6",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  "hard-hat": "M3 17h18M5 17v-3a7 7 0 0 1 4-6.3V11h6V7.7A7 7 0 0 1 19 14v3M10 5h4v2h-4z",
  jobs: "M4 6h16M4 12h10M4 18h6M17 15l2 2 4-4",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  download: "M12 3v12M7 10l5 5 5-5M4 19h16",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  minus: "M5 12h14",
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Icons are decorative by default; pass a title for a standalone meaning. */
  title?: string;
}

export function Icon({ name, size = 16, className, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      data-icon={name}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}

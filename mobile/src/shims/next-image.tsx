// Shim for `next/image` → plain <img>. Drops Next-only optimization props.
import { forwardRef, type ImgHTMLAttributes, type CSSProperties } from "react";

type NextImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  alt?: string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
  loader?: unknown;
};

const Image = forwardRef<HTMLImageElement, NextImageProps>(function Image(
  { src, alt, fill, priority, quality, unoptimized, placeholder, blurDataURL, loader, style, ...rest },
  ref,
) {
  const resolved = typeof src === "string" ? src : src?.src || "";
  const fillStyle: CSSProperties = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }
    : {};
  return (
    <img
      ref={ref}
      src={resolved}
      alt={alt || ""}
      style={{ ...fillStyle, ...(style as CSSProperties) }}
      {...rest}
    />
  );
});

export default Image;

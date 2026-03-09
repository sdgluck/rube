import { useState, type ImgHTMLAttributes } from "react";

export default function FadeImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);

  return (
    <img
      {...props}
      onLoad={(e) => {
        setLoaded(true);
        props.onLoad?.(e);
      }}
      style={{
        ...props.style,
        opacity: loaded ? 1 : 0,
        transition: "opacity 250ms ease-in",
      }}
    />
  );
}

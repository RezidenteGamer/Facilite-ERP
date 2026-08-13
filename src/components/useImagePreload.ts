import { useEffect, useState } from "react";

/**
 * Precarrega uma imagem fora do fluxo normal do <img>/CSS e avisa quando ela
 * termina de chegar — usado para cruzar de um placeholder (borrado/leve)
 * para a imagem final com um fade suave, em vez do "pop" de aparecer pronta.
 */
export function useImagePreload(src: string): boolean {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.src = src;
    if (img.complete) setLoaded(true);
    return () => {
      img.onload = null;
    };
  }, [src]);

  return loaded;
}

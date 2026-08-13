import "./FadeImage.css";
import { useImagePreload } from "./useImagePreload";

type FadeImageProps = {
  src: string;
  alt: string;
  /** Miniatura borrada em base64 — fica visível por baixo até a imagem real carregar. */
  placeholder?: string;
  className?: string;
};

/**
 * <img> que aparece com um fade suave assim que termina de carregar, em vez
 * de "pop" pronta na tela. Com `placeholder`, uma miniatura leve (poucos KB)
 * ocupa o lugar dela até lá.
 *
 * Usa useImagePreload (em vez do onLoad do próprio <img>) porque imagens já
 * em cache — o caso comum aqui, já que vêm do bundle — costumam estar
 * "completas" antes do React conseguir anexar o listener, e o evento onLoad
 * nunca dispara: o fade nunca acontece e só o placeholder borrado fica visível.
 */
export default function FadeImage({ src, alt, placeholder, className }: FadeImageProps) {
  const loaded = useImagePreload(src);

  return (
    <span
      className={`fade-image${className ? ` ${className}` : ""}`}
      style={placeholder ? { backgroundImage: `url(${placeholder})` } : undefined}
    >
      <img
        src={src}
        alt={alt}
        className={`fade-image__img${loaded ? " fade-image__img--loaded" : ""}`}
      />
    </span>
  );
}

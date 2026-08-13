import { useRef, useState, type DragEvent } from "react";
import "./PhotoDropzone.css";

type PhotoDropzoneProps = {
  imageUrl?: string | null;
  hint?: string;
  uploading?: boolean;
  disabled?: boolean;
  onFileSelected: (file: File) => void;
};

/**
 * Área de imagem clicável e arrastável — usada tanto na ficha (registro já
 * selecionado) quanto dentro dos modais de criação/edição. Não sabe nada de
 * domínio (cliente, produto etc.), só entrega o `File` escolhido.
 */
export default function PhotoDropzone({
  imageUrl,
  hint,
  uploading = false,
  disabled = false,
  onFileSelected,
}: PhotoDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFirstImageFile(files: FileList | null): File | null {
    if (!files) return null;
    for (const file of files) {
      if (file.type.startsWith("image/")) return file;
    }
    return null;
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    const file = pickFirstImageFile(event.dataTransfer.files);
    if (file) onFileSelected(file);
  }

  return (
    <div
      className={`photo-dropzone${dragOver ? " photo-dropzone--dragover" : ""}${disabled ? " photo-dropzone--disabled" : ""}`}
      onClick={() => !disabled && !uploading && inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled && !uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Escolher ou arrastar uma foto"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        disabled={disabled || uploading}
        onChange={(event) => {
          const file = pickFirstImageFile(event.target.files);
          if (file) onFileSelected(file);
          event.target.value = "";
        }}
      />

      {imageUrl ? (
        <img className="photo-dropzone__image" src={imageUrl} alt="" />
      ) : (
        <svg viewBox="0 0 64 52" fill="none" aria-hidden="true" className="photo-dropzone__placeholder">
          <rect x="12" y="4" width="46" height="34" rx="2" stroke="currentColor" strokeWidth="2.5" />
          <rect
            x="4"
            y="12"
            width="46"
            height="34"
            rx="2"
            fill="var(--blue-panel-edge)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <circle cx="38" cy="22" r="4" stroke="currentColor" strokeWidth="2.5" />
          <path d="M6 40l12-11 9 8 7-6 15 13" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      )}

      {uploading && <span className="photo-dropzone__uploading">Enviando...</span>}
      {!uploading && hint && <span className="photo-dropzone__hint">{hint}</span>}
    </div>
  );
}

/**
 * Redimensiona e comprime uma imagem no navegador antes do upload.
 * Nunca lança erro: se o processamento falhar por qualquer motivo,
 * devolve o arquivo original para não bloquear o fluxo de upload.
 */
export async function resizeImageForUpload(
  file: File,
  maxDimension = 800,
  quality = 0.8,
): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);

    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) return file;

    const baseName = file.name.includes(".")
      ? file.name.slice(0, file.name.lastIndexOf("."))
      : file.name;

    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

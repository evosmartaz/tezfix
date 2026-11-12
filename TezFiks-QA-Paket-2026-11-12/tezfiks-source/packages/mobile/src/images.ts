import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api, type ApiClient, type FileKind, type FileRef } from '@tezfiks/shared';

export interface PickedImage {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  /** Pixel size as reported by the picker/camera (optional; measured when missing). */
  width?: number | null;
  height?: number | null;
}

/**
 * Longest side of uploaded photos (spec §13: expo-image-manipulator resizes before upload). 1600 px keeps request
 * photos and KYC documents readable while a JPEG at 0.8 stays far below the 8 MB server limit.
 */
export const UPLOAD_MAX_SIDE = 1600;
export const UPLOAD_JPEG_QUALITY = 0.8;

export interface PrepareImageOptions {
  maxSide?: number;
  quality?: number;
}

/** Size after fitting (w, h) inside a maxSide square, keeping the aspect ratio; null when no resize is needed. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0) || Math.max(width, height) <= maxSide) return null;
  return width >= height ? { width: maxSide } : { height: maxSide };
}

function jpegName(fileName: string | null | undefined): string {
  const base = (fileName ?? '').replace(/\.[^.]*$/, '').trim();
  return `${base || 'upload'}.jpg`;
}

/**
 * Downscales a picked image so its longest side is at most `maxSide` and re-encodes it as JPEG (HEIC/PNG from the
 * gallery become JPEG too). Never throws: if the manipulator fails, the original image is returned and the server's
 * 8 MB limit still applies.
 */
export async function prepareImageForUpload(image: PickedImage, opts: PrepareImageOptions = {}): Promise<PickedImage> {
  const maxSide = opts.maxSide ?? UPLOAD_MAX_SIDE;
  const quality = opts.quality ?? UPLOAD_JPEG_QUALITY;
  try {
    const context = ImageManipulator.manipulate(image.uri);
    let resize = image.width && image.height ? fitWithin(image.width, image.height, maxSide) : null;
    if (resize) context.resize(resize);
    let rendered = await context.renderAsync();
    if (!resize) {
      // Size unknown up front (or already small): measure the decoded image and resize if it is still too big.
      resize = fitWithin(rendered.width, rendered.height, maxSide);
      if (resize) {
        rendered.release?.();
        context.resize(resize);
        rendered = await context.renderAsync();
      }
    }
    const saved = await rendered.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    rendered.release?.();
    context.release?.();
    return { uri: saved.uri, mimeType: 'image/jpeg', fileName: jpegName(image.fileName), width: saved.width, height: saved.height };
  } catch {
    return image;
  }
}

export interface UploadImageOptions {
  /** Resize/re-encode before upload (default true). */
  resize?: boolean | PrepareImageOptions;
}

/** Uploads a local image (multipart "kind" + "file"), resized first. Used by the profile screen and later by request photos/KYC. */
export async function uploadImage(client: ApiClient, image: PickedImage, kind: FileKind, opts: UploadImageOptions = {}): Promise<FileRef> {
  const ready = opts.resize === false ? image : await prepareImageForUpload(image, typeof opts.resize === 'object' ? opts.resize : {});
  const type = ready.mimeType || 'image/jpeg';
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const formData = new FormData();
  formData.append('kind', kind);
  formData.append('file', { uri: ready.uri, name: ready.fileName || `upload.${ext}`, type } as unknown as Blob);
  return client.call(api.files.upload, { formData });
}

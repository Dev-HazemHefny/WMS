import { assertValidImageDataUrl } from "../domain/values";
import type { IdGenerator, ImageStorage, TransactionEffects } from "./ports";

export function replaceCatalogImage(
  { images, ids }: { images: ImageStorage; ids: IdGenerator },
  effects: TransactionEffects,
  folder: "products" | "brands",
  dataUrl: string | null | undefined,
  previous: string | null,
): string | null {
  if (dataUrl === undefined) return previous;

  let next: string | null = null;
  if (dataUrl !== null) {
    const extension = assertValidImageDataUrl(dataUrl);
    const path = images.save({ dataUrl, folder, fileName: `${ids.next()}.${extension}` });
    next = path;
    if (path !== previous) effects.onRollback(() => images.remove(path));
  }
  if (previous && previous !== next) effects.onCommit(() => images.remove(previous));
  return next;
}

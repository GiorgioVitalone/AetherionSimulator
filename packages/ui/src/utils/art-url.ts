/**
 * Art URL resolver — converts relative art paths to full URLs.
 * The base URL comes from the consuming app (via ArtContext),
 * keeping this package environment-agnostic.
 */

export function resolveArtUrl(artUrl: string | undefined, baseUrl: string): string | null {
  if (!artUrl || !baseUrl) return null;
  if (artUrl.startsWith('Art/')) {
    // Art/Characters/foo.webp → http://localhost:9000/aetherion-art/Characters/foo.webp
    const path = artUrl.slice(4); // strip "Art/"
    return `${baseUrl}/${path}`;
  }
  return null;
}

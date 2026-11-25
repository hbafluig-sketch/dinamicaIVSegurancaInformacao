export function resolveAssetUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/assets/')) {
    const base =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      typeof import.meta.env.BASE_URL === 'string'
        ? import.meta.env.BASE_URL
        : './';
    const cleanBase = base.endsWith('/') ? base : `${base}/`;
    return `${cleanBase}${url.slice(1)}`;
  }
  return url;
}

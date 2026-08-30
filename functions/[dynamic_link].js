const serviceManagerOrigin = 'https://servicemanager.kcac.ca';
const dynamicLinkSegmentPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function onRequest({ request }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Dynamic links support GET and HEAD only.', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }

  const url = new URL(request.url);
  const segment = normalizeSegment(url.pathname);
  if (!segment || !dynamicLinkSegmentPattern.test(segment)) {
    return new Response('Not found.', { status: 404 });
  }

  const redirectUrl = new URL(`/go/${segment}`, serviceManagerOrigin);
  redirectUrl.search = url.search;
  return Response.redirect(redirectUrl.toString(), 302);
}

function normalizeSegment(pathname) {
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return '';
  }

  const segments = decodedPathname
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);

  return segments.length === 1 ? segments[0].trim().toLowerCase() : '';
}

const configuredBase = import.meta.env.VITE_API_BASE_URL || window.location.origin;

export function apiUrl(path) {
  return `${configuredBase}${path}`;
}

export function socketUrl() {
  const url = new URL(configuredBase);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  return url.toString();
}

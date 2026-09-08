const BACKEND_HOST = 'static.174.140.217.95.clients.your-server.de';
const BACKEND_PORT = '25901';
const WS_PATH = '/vless-ws';

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname !== WS_PATH) {
      return new Response('Not Found', { status: 404 });
    }

    const upstreamUrl = new URL(request.url);
    upstreamUrl.protocol = 'http:';
    upstreamUrl.hostname = BACKEND_HOST;
    upstreamUrl.port = BACKEND_PORT;

    const headers = new Headers(request.headers);
    headers.set('Host', BACKEND_HOST);

    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual'
    });

    return fetch(upstreamRequest);
  }
};

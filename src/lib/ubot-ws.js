/**
 * Workers-native WebSocket transport for GramJS.
 *
 * GramJS's built-in PromisedWebSockets uses the `websocket` npm package
 * (W3CWebSocket → Node TCP). That works under wrangler dev's Node polyfills
 * but fails on production Cloudflare Workers where no raw sockets exist.
 *
 * This drop-in replacement uses the Workers-global `WebSocket` with the
 * exact same read/write/close interface that GramJS's Connection class expects.
 */

class WorkersWebSocket {
  constructor() {
    this.client = undefined;
    this.stream = new Uint8Array(0);
    this.closed = true;
    this.resolveRead = null;
    this.canRead = new Promise((resolve) => {
      this.resolveRead = resolve;
    });
  }

  async readExactly(number) {
    let readData = new Uint8Array(0);
    while (number > 0) {
      const chunk = await this.read(number);
      const merged = new Uint8Array(readData.length + chunk.length);
      merged.set(readData, 0);
      merged.set(chunk, readData.length);
      readData = merged;
      number -= chunk.length;
    }
    return Buffer.from(readData);
  }

  async read(number) {
    if (this.closed) throw new Error('WebSocket was closed');
    await this.canRead;
    if (this.closed) throw new Error('WebSocket was closed');

    const toReturn = this.stream.slice(0, number);
    this.stream = this.stream.slice(number);

    if (this.stream.length === 0) {
      this.canRead = new Promise((resolve) => {
        this.resolveRead = resolve;
      });
    }

    return Buffer.from(toReturn);
  }

  async readAll() {
    if (this.closed) throw new Error('WebSocket was closed');
    await this.canRead;
    if (this.closed) throw new Error('WebSocket was closed');

    const toReturn = this.stream;
    this.stream = new Uint8Array(0);
    this.canRead = new Promise((resolve) => {
      this.resolveRead = resolve;
    });
    return Buffer.from(toReturn);
  }

  getWebSocketLink(ip, port, testServers) {
    if (port === 443) {
      return `wss://${ip}:${port}/apiws${testServers ? '_test' : ''}`;
    }
    return `ws://${ip}:${port}/apiws${testServers ? '_test' : ''}`;
  }

  async connect(port, ip, testServers = false) {
    this.stream = new Uint8Array(0);
    this.canRead = new Promise((resolve) => {
      this.resolveRead = resolve;
    });
    this.closed = false;

    const url = this.getWebSocketLink(ip, port, testServers);

    // Try fetch-based upgrade first (most reliable on Workers), fall back to constructor.
    let ws;
    try {
      const resp = await fetch(url, {
        headers: {
          Upgrade: 'websocket',
          'Sec-WebSocket-Protocol': 'binary',
        },
      });
      ws = resp.webSocket;
      if (!ws) throw new Error('no webSocket on response');
      ws.accept();
    } catch {
      // Fallback: direct constructor (supported on Workers since 2023)
      ws = new WebSocket(url, 'binary');
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('WS open timeout')), 20000);
        ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
        ws.addEventListener('error', (e) => { clearTimeout(t); reject(e); }, { once: true });
      });
    }

    this.client = ws;

    this.client.addEventListener('message', (event) => {
      let data;
      if (event.data instanceof ArrayBuffer) {
        data = new Uint8Array(event.data);
      } else if (typeof event.data === 'string') {
        data = new TextEncoder().encode(event.data);
      } else {
        data = new Uint8Array(event.data);
      }

      const merged = new Uint8Array(this.stream.length + data.length);
      merged.set(this.stream, 0);
      merged.set(data, this.stream.length);
      this.stream = merged;

      if (this.resolveRead) {
        this.resolveRead(true);
      }
    });

    this.client.addEventListener('close', () => {
      this.closed = true;
      if (this.resolveRead) {
        this.resolveRead(false);
      }
    });

    this.client.addEventListener('error', () => {
      this.closed = true;
      if (this.resolveRead) {
        this.resolveRead(false);
      }
    });

    return this;
  }

  write(data) {
    if (this.closed) throw new Error('WebSocket was closed');
    if (this.client) {
      if (data instanceof Buffer || data instanceof Uint8Array) {
        this.client.send(data);
      } else {
        this.client.send(data);
      }
    }
  }

  async close() {
    if (this.client) {
      try {
        this.client.close();
      } catch { /* already closed */ }
    }
    this.closed = true;
  }

  toString() {
    return 'WorkersWebSocket';
  }
}

export { WorkersWebSocket };

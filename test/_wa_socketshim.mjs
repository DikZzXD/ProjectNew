// Shim `cloudflare:sockets` di atas node:net + node:tls, khusus buat nguji
// waproxy.js di luar Workers. Perilaku yang ditiru: connect() dgn
// secureTransport 'starttls' -> socket polos, lalu startTls() bikin socket TLS
// baru dan mematikan socket lama (persis seperti runtime Workers, termasuk
// close() pada socket lama yang MELEMPAR error setelah upgrade).
import net from 'node:net';
import tls from 'node:tls';
import { Duplex } from 'node:stream';

export function connect({ hostname, port }, opts = {}) {
  const sock = net.connect({ host: hostname, port });
  const web = Duplex.toWeb(sock);
  let upgraded = false;

  return {
    get readable() {
      if (upgraded) throw new Error('This socket has been upgraded to TLS');
      return web.readable;
    },
    get writable() {
      if (upgraded) throw new Error('This socket has been upgraded to TLS');
      return web.writable;
    },
    startTls({ expected_server_hostname }) {
      if (opts.secureTransport !== 'starttls') throw new Error('secureTransport bukan starttls');
      upgraded = true;
      const secure = tls.connect({ socket: sock, servername: expected_server_hostname });
      const secWeb = Duplex.toWeb(secure);
      return {
        readable: secWeb.readable,
        writable: secWeb.writable,
        close: () => {
          secure.destroy();
          return Promise.resolve();
        },
      };
    },
    close() {
      if (upgraded) throw new Error('Cannot close a socket that has been upgraded to TLS');
      sock.destroy();
      return Promise.resolve();
    },
  };
}

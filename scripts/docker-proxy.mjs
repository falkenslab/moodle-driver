// Inside the test container: localhost:<port> forwards to the Moodle sandbox on the Docker network,
// since the sandbox's pages and redirects name http://localhost:<port>.
//
//   node scripts/docker-proxy.mjs 8080 webserver:80
import net from "node:net";

const [port = "8080", target = "webserver:80"] = process.argv.slice(2);
const [host, targetPort] = target.split(":");

net
  .createServer((client) => {
    const upstream = net.connect(Number(targetPort), host);
    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  })
  .listen(Number(port), "127.0.0.1");

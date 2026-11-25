// Dev-only playground: `pnpm playground`. Serves on the LAN and prints a QR
// code for the network URL, so the same page opens on a phone.
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import QRCode from "qrcode";
import { execSync } from "node:child_process";
import { networkInterfaces } from "node:os";

/** The IPv4 address of the interface the default route uses (Wi-Fi, not a VPN). */
function defaultRouteAddress(): string | null {
  try {
    const cmd = process.platform === "darwin" ? "route -n get default" : "ip route show default";
    const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const iface = out.match(/interface:\s*(\S+)/)?.[1] ?? out.match(/\bdev\s+(\S+)/)?.[1];
    const addr = iface && networkInterfaces()[iface]?.find((a) => a.family === "IPv4" && !a.internal);
    return addr ? addr.address : null;
  } catch {
    return null;
  }
}

/** The network URL a phone on the same Wi-Fi can reach. PLAYGROUND_HOST overrides. */
function networkUrl(server: ViteDevServer): string | null {
  const urls = server.resolvedUrls?.network ?? [];
  const host = process.env.PLAYGROUND_HOST ?? defaultRouteAddress();
  return urls.find((u) => host && new URL(u).hostname === host) ?? urls[0] ?? null;
}

function qr(): Plugin {
  let server: ViteDevServer;
  return {
    name: "drwr-playground-qr",
    apply: "serve",
    configureServer(s) {
      server = s;
      s.httpServer?.once("listening", () => {
        // resolvedUrls is filled in right after "listening"
        setTimeout(async () => {
          const url = networkUrl(server);
          if (!url) {
            server.config.logger.warn("  no network URL: is --host set?");
            return;
          }
          const code = await QRCode.toString(url, { type: "terminal", small: true });
          server.config.logger.info(`\n  scan to open on your phone (same Wi-Fi): ${url}\n\n${code}`);
        }, 0);
      });
    },
    // The page shows the same QR on desktop: hand it the network URL.
    transformIndexHtml() {
      const url = server && networkUrl(server);
      if (!url) return;
      return [{ tag: "meta", attrs: { name: "network-url", content: url }, injectTo: "head" }];
    },
  };
}

export default defineConfig(({ command }) => {
  // Never deployed: the public demo (drwr.apvl.dev) is built from demo/.
  if (command === "build") throw new Error("the playground is dev only: run `pnpm playground`");
  return {
    plugins: [qr()],
    server: { host: true },
  };
});

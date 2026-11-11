# Security

## Reporting a vulnerability

Please report it privately: on GitHub, **Security → Report a vulnerability** in this
repository. Don't open a public issue for it.

Only the latest release gets security fixes.

## What Faderlight exposes

Faderlight runs inside the Stream Deck app on your computer and needs no account or internet
connection.

- **OSC.** It sends to TotalMix FX on UDP (port 7002 by default) and listens for its replies
  (port 9002). When TotalMix runs on the same computer, it listens on `127.0.0.1` only. When
  TotalMix runs on another computer, it listens on every network interface, and takes
  datagrams only from that computer's address. OSC has no authentication, so anyone on your
  network who can send from that address can change the mixer, as with any OSC controller.
- **The Control Center.** A web page served by the plugin on `127.0.0.1`, on a port the system
  picks. It opens from a one-time link that expires after two minutes, then uses an `HttpOnly`,
  `SameSite=Strict` session cookie. Requests must name the server in their `Host` header, and
  the WebSocket must come from the page itself. Other web pages in your browser cannot reach
  it, and neither can other computers. See
  [packages/control-center/README.md](packages/control-center/README.md).
- **Release builds** have no debugger port (`Nodejs.Debug`); development builds do.

Reports about any of these are welcome, as are reports about anything else that looks wrong.

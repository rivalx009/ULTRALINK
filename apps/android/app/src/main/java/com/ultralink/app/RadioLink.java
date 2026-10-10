package com.ultralink.app;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Minimal WebSocket client (RFC 6455) for the native radio — plain Java, no Android or library
 * dependencies, so it keeps working with the screen off and the WebView paused.
 * ws:// and wss:// (TLS with SNI + hostname verification). One reader thread per connection;
 * sends are synchronised and may come from any thread. Callbacks run on the reader thread.
 */
final class RadioLink {
    interface Listener {
        void onOpen(RadioLink l);
        void onText(RadioLink l, String text);
        void onBinary(RadioLink l, byte[] data);
        void onClose(RadioLink l, String why);
    }

    private static final SecureRandom RND = new SecureRandom();
    private final URI uri;
    private final Listener listener;
    private volatile Socket sock;
    private volatile OutputStream out;
    private volatile boolean open = false, closed = false;

    RadioLink(String url, Listener l) { this.uri = URI.create(url); this.listener = l; }

    boolean isOpen() { return open && !closed; }

    void connect() {
        Thread t = new Thread(this::run, "ultralink-radio-ws");
        t.setDaemon(true);
        t.start();
    }

    void close() {
        boolean was = closed; closed = true; open = false;
        try { Socket s = sock; if (s != null) s.close(); } catch (IOException e) { }
        if (was) return;
    }

    boolean sendText(String s) { return send(0x1, s.getBytes(StandardCharsets.UTF_8)); }
    boolean sendBinary(byte[] b) { return send(0x2, b); }

    private boolean send(int opcode, byte[] payload) {
        OutputStream o = out;
        if (o == null || !open || closed) return false;
        int len = payload.length;
        byte[] head;
        if (len < 126) { head = new byte[2 + 4]; head[1] = (byte) (0x80 | len); }
        else if (len < 65536) { head = new byte[4 + 4]; head[1] = (byte) (0x80 | 126); head[2] = (byte) (len >> 8); head[3] = (byte) len; }
        else { head = new byte[10 + 4]; head[1] = (byte) (0x80 | 127); for (int i = 0; i < 8; i++) head[2 + i] = (byte) (((long) len) >> (56 - 8 * i)); }
        head[0] = (byte) (0x80 | opcode);
        byte[] mask = new byte[4]; RND.nextBytes(mask);
        System.arraycopy(mask, 0, head, head.length - 4, 4);
        byte[] frame = new byte[head.length + len];
        System.arraycopy(head, 0, frame, 0, head.length);
        for (int i = 0; i < len; i++) frame[head.length + i] = (byte) (payload[i] ^ mask[i & 3]);
        try {
            synchronized (this) { o.write(frame); o.flush(); }
            return true;
        } catch (IOException e) { close(); return false; }
    }

    private void run() {
        String why = "closed";
        try {
            boolean tls = "wss".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme());
            String host = uri.getHost();
            int port = uri.getPort() > 0 ? uri.getPort() : (tls ? 443 : 80);
            Socket raw = new Socket();
            sock = raw;
            if (closed) throw new IOException("cancelled");
            raw.connect(new InetSocketAddress(host, port), 10000);
            raw.setTcpNoDelay(true);
            raw.setKeepAlive(true);
            Socket s = raw;
            if (tls) {
                SSLSocket ss = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(raw, host, port, true);
                SSLParameters p = ss.getSSLParameters();
                p.setEndpointIdentificationAlgorithm("HTTPS");      // verify the certificate matches the host
                ss.setSSLParameters(p);
                ss.startHandshake();
                s = ss;
            }
            sock = s;
            if (closed) throw new IOException("cancelled");
            raw.setSoTimeout(15000);                                  // handshake timeout
            OutputStream o = s.getOutputStream();
            InputStream in = new BufferedInputStream(s.getInputStream(), 16384);
            byte[] k = new byte[16]; RND.nextBytes(k);
            String path = (uri.getRawPath() == null || uri.getRawPath().isEmpty()) ? "/" : uri.getRawPath();
            if (uri.getRawQuery() != null) path += "?" + uri.getRawQuery();
            String hostHdr = host + ((tls && port == 443) || (!tls && port == 80) ? "" : ":" + port);
            String req = "GET " + path + " HTTP/1.1\r\nHost: " + hostHdr + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + b64(k) + "\r\nSec-WebSocket-Version: 13\r\nUser-Agent: UltralinkRadio/1\r\n\r\n";
            o.write(req.getBytes(StandardCharsets.US_ASCII)); o.flush();
            String status = readHeaders(in);
            if (!status.startsWith("HTTP/1.1 101") && !status.startsWith("HTTP/1.0 101")) throw new IOException("handshake: " + status);
            raw.setSoTimeout(0);                                      // liveness is checked by Radio (app-level ping)
            out = o; open = true;
            if (closed) throw new IOException("cancelled");
            listener.onOpen(this);
            readLoop(in);
        } catch (Exception e) {
            why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        } finally {
            boolean wasClosedByUs = closed;
            close();
            listener.onClose(this, wasClosedByUs ? "closed" : why);
        }
    }

    private static String readHeaders(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c, n = 0;
        while ((c = in.read()) != -1) {
            sb.append((char) c);
            if (++n > 16384) throw new IOException("headers too long");
            int L = sb.length();
            if (L >= 4 && sb.charAt(L - 4) == '\r' && sb.charAt(L - 3) == '\n' && sb.charAt(L - 2) == '\r' && sb.charAt(L - 1) == '\n') break;
        }
        if (c == -1) throw new IOException("eof in handshake");
        int e = sb.indexOf("\r\n");
        return e > 0 ? sb.substring(0, e) : sb.toString();
    }

    private void readLoop(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream frag = null; int fragOp = 0;
        while (!closed) {
            int b0 = in.read(), b1 = in.read();
            if (b0 < 0 || b1 < 0) throw new IOException("eof");
            boolean fin = (b0 & 0x80) != 0; int op = b0 & 0x0f;
            boolean masked = (b1 & 0x80) != 0;
            long len = b1 & 0x7f;
            if (len == 126) len = ((long) rd(in) << 8) | rd(in);
            else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | rd(in); }
            if (len > (1 << 20)) throw new IOException("frame too large");
            byte[] mask = null;
            if (masked) { mask = new byte[4]; readFully(in, mask); }
            byte[] p = new byte[(int) len];
            readFully(in, p);
            if (mask != null) for (int i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
            if (op == 0x8) throw new IOException("server closed");
            if (op == 0x9) { send(0xA, p); continue; }
            if (op == 0xA) continue;
            if (op == 0x0) { if (frag == null) continue; frag.write(p); if (!fin) continue; p = frag.toByteArray(); op = fragOp; frag = null; }
            else if (!fin) { frag = new java.io.ByteArrayOutputStream(); frag.write(p); fragOp = op; continue; }
            if (op == 0x1) listener.onText(this, new String(p, StandardCharsets.UTF_8));
            else if (op == 0x2) listener.onBinary(this, p);
        }
    }

    private static int rd(InputStream in) throws IOException { int v = in.read(); if (v < 0) throw new IOException("eof"); return v; }
    private static void readFully(InputStream in, byte[] b) throws IOException {
        int o = 0; while (o < b.length) { int r = in.read(b, o, b.length - o); if (r < 0) throw new IOException("eof"); o += r; }
    }
    /* java.util.Base64 needs API 26; minSdk is 24 */
    private static String b64(byte[] d) {
        final String A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < d.length; i += 3) {
            int n = (d[i] & 0xff) << 16 | (i + 1 < d.length ? (d[i + 1] & 0xff) << 8 : 0) | (i + 2 < d.length ? d[i + 2] & 0xff : 0);
            sb.append(A.charAt(n >> 18 & 63)).append(A.charAt(n >> 12 & 63));
            sb.append(i + 1 < d.length ? A.charAt(n >> 6 & 63) : '=').append(i + 2 < d.length ? A.charAt(n & 63) : '=');
        }
        return sb.toString();
    }
}

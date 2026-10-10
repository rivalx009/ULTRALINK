package com.ultralink.app;

/**
 * Relay voice format shared with the web app (ul.js): 12 kHz mono, 8-bit mu-law.
 * Frame sent by a unit:      [1][seq hi][seq lo][rate kHz][mu-law samples...]
 * Frame received from relay: [idLen][sender id utf8][same frame as above]
 */
final class RadioCodec {
    static final int RATE = 12000;
    private static final short[] DEC = new short[256];
    static {
        for (int i = 0; i < 256; i++) {
            int u = ~i & 0xff, sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
            int s = (((man << 3) + 132) << exp) - 132;
            DEC[i] = (short) (sign != 0 ? -s : s);
        }
    }
    private RadioCodec() { }

    /** same maths as muEnc() in ul.js; x in -1..1 */
    static int muEnc(float x) {
        int s = (int) (Math.max(-1f, Math.min(1f, x)) * 32635), sign = s < 0 ? 0x80 : 0;
        if (sign != 0) s = -s;
        s += 132; int exp = 7;
        for (int m = 0x4000; (s & m) == 0 && exp > 0; m >>= 1) exp--;
        return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
    }
    static short muDec(int b) { return DEC[b & 0xff]; }

    /** microphone → relay frames: linear resampling from the mic rate to 12 kHz, gain like the web app */
    static final class Encoder {
        private final double ratio; private double pos = 0; private int seq = 0; private final float gain;
        Encoder(int inRate, float gain) { this.ratio = inRate / (double) RATE; this.gain = gain; }
        /** returns one relay frame for this block of PCM16 samples, or null if it produced no output */
        byte[] encode(short[] in, int n) {
            int outN = (int) Math.floor((n - pos) / ratio);
            if (outN <= 0) { pos -= n; if (pos < 0) pos = 0; return null; }
            byte[] out = new byte[4 + outN];
            out[0] = 1; out[1] = (byte) (seq >> 8); out[2] = (byte) seq; out[3] = (byte) (RATE / 1000);
            seq = (seq + 1) & 0xffff;
            double t = pos; int k = 0;
            for (; k < outN; k++, t += ratio) {
                int i = (int) t; double f = t - i;
                float a = in[i] / 32768f, b = i + 1 < n ? in[i + 1] / 32768f : a;
                out[4 + k] = (byte) muEnc((float) (a + (b - a) * f) * gain);
            }
            pos = t - n; if (pos < 0) pos = 0;
            return out;
        }
    }

    /** relay frame → sender id + PCM16 at 12 kHz (resampled if the sender used another rate); null if invalid */
    static final class Decoded { String from; short[] pcm; }
    static Decoded decode(byte[] buf) {
        if (buf == null || buf.length < 6) return null;
        int L = buf[0] & 0xff;
        if (buf.length < 1 + L + 5) return null;
        int o = 1 + L;
        if (buf[o] != 1) return null;
        int rate = (buf[o + 3] & 0xff) * 1000; if (rate <= 0) rate = RATE;
        int n = buf.length - o - 4;
        short[] pcm = new short[n];
        for (int i = 0; i < n; i++) pcm[i] = DEC[buf[o + 4 + i] & 0xff];
        if (rate != RATE) {
            int m = (int) ((long) n * RATE / rate); short[] r = new short[m]; double step = rate / (double) RATE;
            for (int i = 0; i < m; i++) { double t = i * step; int j = (int) t; double f = t - j; int a = pcm[Math.min(j, n - 1)], b = pcm[Math.min(j + 1, n - 1)]; r[i] = (short) (a + (b - a) * f); }
            pcm = r;
        }
        Decoded d = new Decoded();
        d.from = new String(buf, 1, L, java.nio.charset.StandardCharsets.UTF_8);
        d.pcm = pcm;
        return d;
    }
}

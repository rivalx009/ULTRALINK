package com.ultralink.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.SoundPool;
import android.media.ToneGenerator;
import android.media.audiofx.NoiseSuppressor;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.TimeUnit;

/**
 * Native PTT radio (rider mode, Android app v1.7+).
 * Runs inside UltraService, independent of the WebView, so push-to-talk keeps working with the
 * screen off and battery saver on. It opens an audio-only "sidecar" connection to the relay for
 * the rider's unit, and uses the relay voice format of the web app (12 kHz mu-law), so escorts
 * need no changes.
 *   - Bluetooth / headset button, notification TALK and the on-screen button all end up in ptt()/toggle()
 *   - line-open sound (radio_open.mp3), squelch on close, error tone if the radio is not linked
 *   - mic is open only while transmitting; speaker output only while audio arrives
 */
final class Radio implements RadioLink.Listener {
    interface Host { void onRadioState(String state, boolean tx); }

    static final String LINKING = "LINKING", READY = "READY", NO_MISSION = "WAITING", MIC_ERROR = "MIC ERROR", OFF = "OFF";
    private static final long PING_MS = 10000, DEAD_MS = 25000, MIC_DELAY_MS = 150;

    private final Context ctx;
    private final Host host;
    private final HandlerThread thread = new HandlerThread("ultralink-radio");
    private final Handler h;
    private final Sounds sounds;
    private final Player player = new Player();
    private Mic mic;

    private volatile String url = "", code = "", unit = "", callsign = "";
    private volatile RadioLink link;
    private volatile boolean joined = false, tx = false, stopped = false;
    private volatile String state = OFF;
    private int retry = 0;
    private volatile long lastRx = 0;

    Radio(Context c, Host host) {
        this.ctx = c.getApplicationContext(); this.host = host;
        thread.start(); h = new Handler(thread.getLooper());
        sounds = new Sounds(ctx);
        h.postDelayed(watchdog, PING_MS);
    }

    /* ----------------------------------------------------------------- control (any thread) */
    void configure(String url, String code, String unit, String callsign) {
        h.post(() -> {
            if (stopped) return;
            String u = nz(url), c = nz(code), id = nz(unit), cs = nz(callsign);
            if (u.isEmpty() || c.isEmpty() || id.isEmpty()) return;
            boolean same = u.equals(this.url) && c.equals(this.code) && id.equals(this.unit);
            this.url = u; this.code = c; this.unit = id; this.callsign = cs;
            if (same && link != null) return;       // already running for this unit
            reconnect(0);
        });
    }
    void ptt(boolean on) { h.post(() -> setTx(on)); }
    void toggle() { h.post(() -> setTx(!tx)); }
    boolean active() { return !stopped && !unit.isEmpty(); }
    boolean isStopped() { return stopped; }
    String state() { return state; }
    boolean transmitting() { return tx; }

    void stop() {
        h.post(() -> {
            if (stopped) return;
            if (tx) { tx = false; stopMic(); send("{\"t\":\"ptt\",\"state\":\"end\",\"targets\":\"all\"}"); }
            stopped = true; joined = false;
            if (link != null) { link.close(); link = null; }
            player.stop(); sounds.release();
            setState(OFF);
            thread.quitSafely();
        });
    }

    /* ----------------------------------------------------------------- transmit */
    private void setTx(boolean on) {
        if (stopped || on == tx) return;
        if (on) {
            if (!joined || link == null || !link.isOpen()) {        // radio not linked: tell the rider, try again now
                sounds.error(); vibrate(new long[]{0, 80, 80, 80});
                reconnect(0);
                return;
            }
            tx = true;
            sounds.open(); vibrate(new long[]{0, 30});
            send("{\"t\":\"ptt\",\"state\":\"start\",\"targets\":\"all\",\"relay\":\"all\"}");
            h.postDelayed(openMic, MIC_DELAY_MS);                    // so the key sound is not sent
            host.onRadioState(state, true);
        } else {
            tx = false;
            h.removeCallbacks(openMic);
            stopMic();
            send("{\"t\":\"ptt\",\"state\":\"end\",\"targets\":\"all\"}");
            sounds.close();
            host.onRadioState(state, false);
        }
    }
    private final Runnable openMic = () -> {
        if (!tx || stopped) return;
        stopMic();
        mic = new Mic();
        mic.start();
    };
    private void stopMic() { Mic m = mic; mic = null; if (m != null) m.stop(); }

    /* ----------------------------------------------------------------- link */
    private void reconnect(long delay) {
        h.removeCallbacks(connectNow);
        if (delay <= 0) connectNow.run(); else h.postDelayed(connectNow, delay);
    }
    private final Runnable connectNow = () -> {
        if (stopped || url.isEmpty()) return;
        if (link != null) link.close();
        joined = false; setState(LINKING);
        lastRx = SystemClock.elapsedRealtime();
        link = new RadioLink(url, this);
        link.connect();
    };
    private void send(String json) { RadioLink l = link; if (l != null) l.sendText(json); }
    private void sendJoin() {
        try {
            JSONObject j = new JSONObject();
            j.put("t", "join"); j.put("code", code); j.put("role", "rider"); j.put("callsign", callsign);
            j.put("audio", true); j.put("owner", unit);
            send(j.toString());
        } catch (Exception e) { }
    }
    private final Runnable rejoin = () -> { if (!stopped && link != null && link.isOpen() && !joined) sendJoin(); };

    /** app-level ping every 10 s; a link silent for 25 s is dead (phone changed cell / network) → reconnect */
    private final Runnable watchdog = new Runnable() {
        @Override public void run() {
            if (stopped) return;
            if (link != null && link.isOpen()) {
                if (SystemClock.elapsedRealtime() - lastRx > DEAD_MS) reconnect(0);
                else send("{\"t\":\"ping\",\"ts\":" + System.currentTimeMillis() + "}");
            }
            h.postDelayed(this, PING_MS);
        }
    };

    @Override public void onOpen(RadioLink l) {
        h.post(() -> { if (l != link || stopped) return; lastRx = SystemClock.elapsedRealtime(); sendJoin(); });
    }
    @Override public void onText(RadioLink l, String text) {
        lastRx = SystemClock.elapsedRealtime();
        h.post(() -> {
            if (l != link || stopped) return;
            try {
                JSONObject m = new JSONObject(text);
                switch (m.optString("t")) {
                    case "joined": joined = true; retry = 0; h.removeCallbacks(rejoin); setState(READY); break;
                    case "error":                       // mission not there yet (relay restarted): try again shortly
                        joined = false; setState(NO_MISSION); h.removeCallbacks(rejoin); h.postDelayed(rejoin, 4000); break;
                    case "ptt":
                        if (unit.equals(m.optString("from"))) break;
                        if ("start".equals(m.optString("state"))) sounds.open(); else sounds.close();
                        break;
                    case "mission.ended": stop(); break;
                    default: break;
                }
            } catch (Exception e) { }
        });
    }
    @Override public void onBinary(RadioLink l, byte[] data) {
        lastRx = SystemClock.elapsedRealtime();
        if (l != link || stopped) return;
        RadioCodec.Decoded d = RadioCodec.decode(data);
        if (d != null && !unit.equals(d.from)) player.feed(d.pcm);
    }
    @Override public void onClose(RadioLink l, String why) {
        h.post(() -> {
            if (l != link || stopped) return;
            joined = false; link = null; setState(LINKING);
            if (tx) { tx = false; h.removeCallbacks(openMic); stopMic(); host.onRadioState(state, false); }
            long wait = Math.min(8000, 500L << Math.min(retry++, 4));
            reconnect(wait);
        });
    }

    private void setState(String s) { if (s.equals(state)) return; state = s; host.onRadioState(s, tx); }
    private static String nz(String s) { return s == null ? "" : s.trim(); }

    private void vibrate(long[] pattern) {
        try {
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(pattern, -1)); else v.vibrate(pattern, -1);
        } catch (Exception e) { }
    }

    /* ================================================================= microphone → relay */
    private final class Mic {
        private volatile boolean running = true;
        private Thread t;
        void start() { t = new Thread(this::loop, "ultralink-radio-mic"); t.start(); }
        void stop() { running = false; }
        private void loop() {
            AudioRecord rec = null; NoiseSuppressor ns = null;
            try {
                int rate = 0, min = 0;
                for (int r : new int[]{16000, 48000, 44100, 8000}) {
                    int m = AudioRecord.getMinBufferSize(r, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    if (m > 0) { rate = r; min = m; break; }
                }
                if (rate == 0) throw new IllegalStateException("no mic rate");
                int frame = rate / 25;                                     // 40 ms blocks
                rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, rate, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT, Math.max(min, frame * 2 * 4));
                if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("mic busy");
                if (NoiseSuppressor.isAvailable()) { try { ns = NoiseSuppressor.create(rec.getAudioSessionId()); if (ns != null) ns.setEnabled(true); } catch (Exception e) { } }
                rec.startRecording();
                RadioCodec.Encoder enc = new RadioCodec.Encoder(rate, 1.4f);
                short[] buf = new short[frame];
                while (running) {
                    int n = rec.read(buf, 0, frame);
                    if (n <= 0) { if (n < 0) break; continue; }
                    byte[] out = enc.encode(buf, n);
                    RadioLink l = link;
                    if (out != null && l != null && running) l.sendBinary(out);
                }
            } catch (Exception e) {                                        // no permission / mic held by another app
                h.post(() -> { setState(MIC_ERROR); sounds.error(); });
                h.postDelayed(() -> { if (MIC_ERROR.equals(state)) setState(joined ? READY : LINKING); }, 4000);
            } finally {
                try { if (ns != null) ns.release(); } catch (Exception e) { }
                if (rec != null) { try { rec.stop(); } catch (Exception e) { } rec.release(); }
            }
        }
    }

    /* ================================================================= relay → speaker */
    private static final class Player {
        private final LinkedBlockingDeque<short[]> q = new LinkedBlockingDeque<>();
        private volatile boolean running = true;
        private Thread t;
        void feed(short[] pcm) {
            synchronized (this) {
                if (t == null && running) { t = new Thread(this::loop, "ultralink-radio-play"); t.start(); }
            }
            q.offer(pcm);
            while (q.size() > 30) q.poll();                                // never more than ~1.2 s behind
        }
        void stop() { running = false; synchronized (this) { if (t != null) t.interrupt(); } }
        private void loop() {
            AudioTrack tr = null; boolean playing = false;
            try {
                int rate = RadioCodec.RATE;
                int min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                tr = new AudioTrack(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
                    new AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
                    Math.max(min, rate), AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE);
                short[] lead = new short[rate * 12 / 100];                 // 120 ms jitter cushion at the start of a transmission
                while (running) {
                    short[] pcm = q.poll(600, TimeUnit.MILLISECONDS);
                    if (pcm == null) {                                     // quiet: release the speaker path (battery)
                        if (playing) { tr.stop(); playing = false; }
                        continue;
                    }
                    if (!playing) { tr.play(); tr.write(lead, 0, lead.length); playing = true; }
                    tr.write(pcm, 0, pcm.length);
                }
            } catch (InterruptedException e) {
            } catch (Exception e) {
            } finally {
                if (tr != null) { try { tr.stop(); } catch (Exception e) { } tr.release(); }
                synchronized (this) { t = null; }
            }
        }
    }

    /* ================================================================= sounds */
    private static final class Sounds {
        private SoundPool pool;
        private int open = 0, close = 0;
        private final boolean[] loaded = new boolean[64];
        private ToneGenerator tone;
        Sounds(Context c) {
            try {
                pool = new SoundPool.Builder().setMaxStreams(3).setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build();
                pool.setOnLoadCompleteListener((p, id, status) -> { if (status == 0 && id < loaded.length) loaded[id] = true; });
                open = pool.load(c, R.raw.radio_open, 1);
                File sq = new File(c.getCacheDir(), "radio_close.wav");
                if (!sq.exists()) writeSquelch(sq);
                close = pool.load(sq.getAbsolutePath(), 1);
            } catch (Exception e) { }
            try { tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 70); } catch (Exception e) { tone = null; }
        }
        void open() { if (!play(open, 1f)) beep(ToneGenerator.TONE_PROP_BEEP2, 150); }
        void close() { if (!play(close, 0.6f)) beep(ToneGenerator.TONE_PROP_ACK, 80); }
        void error() { beep(ToneGenerator.TONE_PROP_NACK, 350); }
        private boolean play(int id, float vol) {
            if (pool == null || id <= 0 || id >= loaded.length || !loaded[id]) return false;
            return pool.play(id, vol, vol, 1, 0, 1f) != 0;
        }
        private void beep(int t, int ms) { try { if (tone != null) tone.startTone(t, ms); } catch (Exception e) { } }
        void release() {
            try { if (pool != null) pool.release(); } catch (Exception e) { }
            try { if (tone != null) tone.release(); } catch (Exception e) { }
            pool = null; tone = null;
        }
        /** short squelch tail like the web app: 80 ms of fading noise + a soft 880 Hz blip (16 kHz WAV) */
        private static void writeSquelch(File f) throws Exception {
            int rate = 16000, n = rate * 110 / 1000;
            byte[] pcm = new byte[n * 2];
            java.util.Random r = new java.util.Random(7);
            double lp = 0;
            for (int i = 0; i < n; i++) {
                double t = i / (double) rate, v = 0;
                if (t < 0.08) { lp += 0.35 * ((r.nextDouble() * 2 - 1) - lp); v += lp * 0.5 * (1 - t / 0.08); }
                if (t > 0.03 && t < 0.08) v += Math.sin(2 * Math.PI * 880 * t) * 0.18 * (1 - (t - 0.03) / 0.05);
                int s = (int) Math.max(-32767, Math.min(32767, v * 32767));
                pcm[2 * i] = (byte) s; pcm[2 * i + 1] = (byte) (s >> 8);
            }
            try (FileOutputStream o = new FileOutputStream(f)) {
                o.write(wavHeader(pcm.length, rate)); o.write(pcm);
            }
        }
        private static byte[] wavHeader(int dataLen, int rate) {
            java.nio.ByteBuffer b = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            b.put("RIFF".getBytes()).putInt(36 + dataLen).put("WAVE".getBytes()).put("fmt ".getBytes()).putInt(16)
             .putShort((short) 1).putShort((short) 1).putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16)
             .put("data".getBytes()).putInt(dataLen);
            return b.array();
        }
    }
}

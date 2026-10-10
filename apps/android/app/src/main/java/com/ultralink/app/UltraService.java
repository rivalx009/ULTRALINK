package com.ultralink.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.view.KeyEvent;

/**
 * Foreground service for rider mode: native GPS (1 Hz) that keeps running with the screen off,
 * a partial wake lock, a notification with TALK / STOP TRACKING, a media session so a Bluetooth
 * headset / handlebar remote button toggles push-to-talk, and (v1.7) the native radio (Radio.java),
 * which carries the rider's voice without the WebView, so PTT keeps working with the screen off.
 */
public class UltraService extends Service implements LocationListener, Radio.Host {
    private static final String CH = "ultralink_track";
    private static final int NID = 15;
    static UltraService self;
    private LocationManager lm;
    private PowerManager.WakeLock wl;
    private MediaSession ms;
    private String code = "", callsign = "";
    private boolean talking = false;
    private Radio radio;
    /* radio settings from the page (may arrive before the service has started) */
    private static volatile String rUrl, rCode, rUnit, rCall;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent i, int flags, int id) {
        self = this;
        if (i != null) { code = nz(i.getStringExtra("code")); callsign = nz(i.getStringExtra("callsign")); }
        channel();
        Notification n = note();
        if (Build.VERSION.SDK_INT >= 30) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NID, n);
        if (wl == null) { PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE); wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ultralink:track"); wl.setReferenceCounted(false); wl.acquire(); }
        startGps();
        startMediaButtons();
        applyRadio();
        return START_STICKY;
    }
    private static String nz(String s) { return s == null ? "" : s; }

    private void startGps() {
        try {
            if (lm == null) lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            lm.removeUpdates(this);
            boolean any = false;
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper()); any = true; }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) { lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 3000, 0, this, Looper.getMainLooper()); any = true; }
            if (!any && MainActivity.current != null) MainActivity.current.onGpsError("LOCATION OFF");
        } catch (SecurityException e) {
            if (MainActivity.current != null) MainActivity.current.onGpsError("NO PERMISSION");
        }
    }
    /** escort pressed REFRESH GPS: restart the providers and push the newest fix straight away */
    static void requestFix() {
        UltraService s = self; if (s == null) return;
        s.startGps();
        try {
            Location l = s.lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (l != null && System.currentTimeMillis() - l.getTime() < 10000) s.onLocationChanged(l);
        } catch (SecurityException e) { }
    }

    private long lastGps = 0;
    @Override public void onLocationChanged(Location l) {
        boolean gps = LocationManager.GPS_PROVIDER.equals(l.getProvider());
        if (gps) lastGps = System.currentTimeMillis();
        else if (System.currentTimeMillis() - lastGps < 5000) return;          // prefer GPS fixes over network ones
        MainActivity a = MainActivity.current;
        if (a != null) a.onLocation(l.getLatitude(), l.getLongitude(), l.hasAccuracy() ? l.getAccuracy() : 30f,
            l.hasSpeed() ? l.getSpeed() : -1f, l.hasBearing() ? l.getBearing() : -1f, l.hasAltitude() ? l.getAltitude() : 0, l.getTime());
    }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }
    @Override public void onStatusChanged(String p, int s, Bundle b) { }

    private void channel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(CH, "ULTRALINK tracking", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Shown while ULTRALINK is tracking and the radio is on");
            c.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
        }
    }
    private Notification note() {
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent po = PendingIntent.getActivity(this, 0, open, fl);
        PendingIntent pt = PendingIntent.getBroadcast(this, 1, new Intent(MainActivity.ACTION_TALK).setPackage(getPackageName()), fl);
        PendingIntent ps = PendingIntent.getBroadcast(this, 2, new Intent(MainActivity.ACTION_STOP).setPackage(getPackageName()), fl);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_ultralink)
         .setContentTitle(talking ? "ULTRALINK · TRANSMITTING" : "ULTRALINK active")
         .setContentText((callsign.isEmpty() ? "Tracking" : callsign) + (code.isEmpty() ? "" : " · mission " + code) + " · GPS + radio on")
         .setOngoing(true).setShowWhen(false).setContentIntent(po)
         .addAction(new Notification.Action.Builder(null, talking ? "STOP TALK" : "TALK", pt).build())
         .addAction(new Notification.Action.Builder(null, "STOP TRACKING", ps).build());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }
    static void talking(boolean on) {
        UltraService s = self; if (s == null) return;
        s.talking = on;
        ((NotificationManager) s.getSystemService(NOTIFICATION_SERVICE)).notify(NID, s.note());
    }
    private void startMediaButtons() {
        if (ms != null) return;
        ms = new MediaSession(this, "ultralink");
        ms.setCallback(new MediaSession.Callback() {
            @Override public boolean onMediaButtonEvent(Intent i) {
                KeyEvent e = i.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                if (e != null && e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                    if (radio != null && radio.active()) { radio.toggle(); return true; }   // native radio: works with the screen off
                    MainActivity a = MainActivity.current; if (a != null) a.js("window.ULNative&&ULNative.togglePtt()");
                    return true;
                }
                return super.onMediaButtonEvent(i);
            }
        });
        ms.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE)
            .setState(PlaybackState.STATE_PLAYING, 0, 1f).build());
        ms.setActive(true);
    }
    /* ------------------------------------------------------------------ native radio */
    static void startRadio(String url, String code, String unit, String callsign) {
        rUrl = url; rCode = code; rUnit = unit; rCall = callsign;
        UltraService s = self; if (s != null) s.ui.post(s::applyRadio);
    }
    private final android.os.Handler ui = new android.os.Handler(Looper.getMainLooper());
    private void applyRadio() {
        if (rUnit == null || rUnit.isEmpty()) return;
        if (radio == null || radio.isStopped()) radio = new Radio(this, this);   // a new mission after the last one ended
        radio.configure(rUrl, rCode, rUnit, rCall);
    }
    /** true when PTT should go to the native radio instead of the web page */
    static boolean radioOn() { UltraService s = self; return s != null && s.radio != null && s.radio.active(); }
    static void radioPtt(boolean on) { UltraService s = self; if (s != null && s.radio != null) s.radio.ptt(on); }
    static void radioToggle() { UltraService s = self; if (s != null && s.radio != null) s.radio.toggle(); }
    static String radioStatus() { UltraService s = self; return s == null || s.radio == null ? Radio.OFF : s.radio.state(); }
    @Override public void onRadioState(String state, boolean tx) {
        ui.post(() -> {
            if (tx != talking) talking(tx);
            MainActivity a = MainActivity.current;
            if (a != null) a.js("window.ULNative&&ULNative.radioState&&ULNative.radioState(" + MainActivity.quote(state) + "," + tx + ")");
        });
    }

    @Override public void onDestroy() {
        if (radio != null) { radio.stop(); radio = null; }
        rUnit = null;
        if (lm != null) lm.removeUpdates(this);
        if (wl != null && wl.isHeld()) wl.release();
        if (ms != null) { ms.setActive(false); ms.release(); ms = null; }
        self = null;
        super.onDestroy();
    }
}

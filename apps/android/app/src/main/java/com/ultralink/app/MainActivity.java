package com.ultralink.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;

/**
 * ULTRALINK Android app (v1.5) — rider AND escort mode.
 * A full-screen WebView around the ULTRALINK web app on the Render relay with:
 *  - first-run server address screen, start page = mode select (rider or escort)
 *  - native GPS + foreground service in rider mode (tracking and radio keep running with the screen off)
 *  - microphone / location permissions, GPX + profile file picker, native "save" for exported profiles
 *  - offline screen with automatic retry, screen kept on while the app is open
 * JS bridge "UltraApp" (same API as v1.4, so the web pages keep working):
 *   getServer() setServer(url) resetServer() retry(url) startTracking(code, callsign) stopTracking()
 *   setTalking(on) requestFix() saveFile(name, text, mime)
 * Native → page: window.ULNative.onPos(lat, lon, acc, spd, hdg, alt, ts) / onGpsError(msg) / ptt(on) / togglePtt() / resume()
 */
public class MainActivity extends Activity {
    static final String PREFS = "ultralink", KEY_SERVER = "server";
    static final String DEFAULT_SERVER = "https://ultralink-1.onrender.com";
    static final String ACTION_TALK = "com.ultralink.app.TALK", ACTION_STOP = "com.ultralink.app.STOP";
    private static final int REQ_PERMS = 7, REQ_FILE = 8;
    static MainActivity current;

    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCb;
    private PermissionRequest pendingMedia;
    private GeolocationPermissions.Callback pendingGeoCb;
    private String pendingGeoOrigin;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final BroadcastReceiver actions = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (ACTION_TALK.equals(i.getAction())) js("window.ULNative&&ULNative.togglePtt()");
            else if (ACTION_STOP.equals(i.getAction())) { stopService(new Intent(MainActivity.this, UltraService.class)); }
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        current = this;
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#05080A"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#05080A"));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " UltralinkApp/" + BuildInfo.VERSION);
        web.addJavascriptInterface(new Bridge(), "UltraApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        IntentFilter f = new IntentFilter(); f.addAction(ACTION_TALK); f.addAction(ACTION_STOP);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(actions, f, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(actions, f);
        askPermissions();
        if (b != null) web.restoreState(b); else openStart();
    }

    private String server() { return prefs.getString(KEY_SERVER, ""); }
    private void openStart() {
        String srv = server();
        if (srv.isEmpty()) web.loadUrl("file:///android_asset/setup.html?server=" + enc(DEFAULT_SERVER));
        else web.loadUrl(srv + "/");
    }
    static String enc(String v) { try { return URLEncoder.encode(v, "UTF-8"); } catch (Exception e) { return v; } }
    static String normalise(String u) {
        u = u == null ? "" : u.trim();
        if (u.isEmpty()) return u;
        if (!u.matches("(?i)^https?://.*")) u = (u.matches("^(localhost|127\\.|192\\.168\\.|10\\.).*") ? "http://" : "https://") + u;
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }
    private boolean sameHost(Uri u) {
        try { Uri s = Uri.parse(server()); return u.getHost() != null && u.getHost().equalsIgnoreCase(s.getHost()); } catch (Exception e) { return false; }
    }
    void js(final String code) { ui.post(() -> { if (web != null) web.evaluateJavascript(code, null); }); }

    /* ------------------------------------------------------------------ permissions */
    private void askPermissions() {
        ArrayList<String> want = new ArrayList<>();
        String[] all = Build.VERSION.SDK_INT >= 33
            ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS}
            : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.RECORD_AUDIO};
        for (String p : all) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) want.add(p);
        if (!want.isEmpty()) requestPermissions(want.toArray(new String[0]), REQ_PERMS);
    }
    private boolean has(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }
    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (pendingMedia != null) {
            if (has(Manifest.permission.RECORD_AUDIO)) pendingMedia.grant(pendingMedia.getResources()); else pendingMedia.deny();
            pendingMedia = null;
        }
        if (pendingGeoCb != null) { pendingGeoCb.invoke(pendingGeoOrigin, has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION), false); pendingGeoCb = null; }
    }

    /* ------------------------------------------------------------------ web clients */
    private class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl(); String sc = u.getScheme() == null ? "" : u.getScheme();
            if (sc.equals("file") || sameHost(u)) return false;
            if (sc.equals("http") || sc.equals("https") || sc.equals("mailto") || sc.equals("tel") || sc.equals("geo")) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }
            return true;
        }
        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame()) return;
            String url = r.getUrl().toString();
            if (url.startsWith("file:")) return;
            v.loadUrl("file:///android_asset/offline.html?server=" + enc(server()) + "&url=" + enc(url) + "&err=" + enc(String.valueOf(e.getDescription())));
        }
    }
    private class Chrome extends WebChromeClient {
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
            if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) cb.invoke(origin, true, false);
            else { pendingGeoCb = cb; pendingGeoOrigin = origin; requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS); }
        }
        @Override public void onPermissionRequest(final PermissionRequest req) {
            ui.post(() -> {
                boolean audio = false;
                for (String r : req.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                if (!audio) { req.deny(); return; }
                if (has(Manifest.permission.RECORD_AUDIO)) req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                else { pendingMedia = req; requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_PERMS); }
            });
        }
        /* <input type=file> — GPX routes and mission profiles in escort planning */
        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try { startActivityForResult(Intent.createChooser(i, "Choose file"), REQ_FILE); }
            catch (Exception e) { fileCb = null; return false; }
            return true;
        }
    }
    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE && fileCb != null) {
            Uri[] r = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) { int n = data.getClipData().getItemCount(); r = new Uri[n]; for (int k = 0; k < n; k++) r[k] = data.getClipData().getItemAt(k).getUri(); }
                else if (data.getData() != null) r = new Uri[]{data.getData()};
            }
            fileCb.onReceiveValue(r); fileCb = null;
        }
    }

    /* ------------------------------------------------------------------ JS bridge */
    private class Bridge {
        @JavascriptInterface public String getServer() { return server(); }
        @JavascriptInterface public String getPlatform() { return "android"; }
        @JavascriptInterface public void setServer(String url) {
            final String u = normalise(url);
            prefs.edit().putString(KEY_SERVER, u).apply();
            ui.post(() -> web.loadUrl(u + "/"));
        }
        @JavascriptInterface public void resetServer() {
            ui.post(() -> web.loadUrl("file:///android_asset/setup.html?server=" + enc(server().isEmpty() ? DEFAULT_SERVER : server())));
        }
        @JavascriptInterface public void retry(String url) {
            final String u = url != null && !url.isEmpty() && sameHost(Uri.parse(url)) ? url : server() + "/";
            ui.post(() -> web.loadUrl(u));
        }
        @JavascriptInterface public void startTracking(String code, String callsign) {
            Intent i = new Intent(MainActivity.this, UltraService.class);
            i.putExtra("code", code); i.putExtra("callsign", callsign);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
        }
        @JavascriptInterface public void stopTracking() { stopService(new Intent(MainActivity.this, UltraService.class)); }
        @JavascriptInterface public void setTalking(boolean on) { UltraService.talking(on); }
        @JavascriptInterface public void requestFix() { UltraService.requestFix(); }
        @JavascriptInterface public void saveFile(String name, String text, String mime) { save(name, text, mime); }
    }

    /** exported profiles go to Downloads */
    private void save(String name, String text, String mime) {
        try {
            String fn = name == null || name.isEmpty() ? "ultralink.json" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
            byte[] data = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, fn);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(data); }
            } else {
                File d = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS); d.mkdirs();
                try (FileOutputStream o = new FileOutputStream(new File(d, fn))) { o.write(data); }
            }
            ui.post(() -> Toast.makeText(this, "Saved to Downloads: " + fn, Toast.LENGTH_LONG).show());
        } catch (Exception e) {
            ui.post(() -> Toast.makeText(this, "Save failed: " + e.getMessage(), Toast.LENGTH_LONG).show());
        }
    }

    /* ------------------------------------------------------------------ native GPS → page */
    void onLocation(double lat, double lon, float acc, float spd, float hdg, double alt, long ts) {
        js(String.format(Locale.US, "window.ULNative&&ULNative.onPos(%.7f,%.7f,%.1f,%.2f,%.1f,%.1f,%d)", lat, lon, acc, spd, hdg, alt, ts));
    }
    void onGpsError(String msg) { js("window.ULNative&&ULNative.onGpsError(" + quote(msg) + ")"); }
    static String quote(String s) { return "'" + String.valueOf(s).replace("\\", "\\\\").replace("'", "\\'") + "'"; }

    /* Bluetooth / headset media button toggles PTT while the app is open */
    @Override public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_BACK && web.canGoBack()) { web.goBack(); return true; }
        if ((code == KeyEvent.KEYCODE_HEADSETHOOK || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) && e.getRepeatCount() == 0) { js("window.ULNative&&ULNative.togglePtt()"); return true; }
        return super.onKeyDown(code, e);
    }
    @Override protected void onResume() { super.onResume(); current = this; web.onResume(); js("window.ULNative&&ULNative.resume&&ULNative.resume()"); }
    @Override protected void onPause() { super.onPause(); /* keep the WebView running: telemetry + radio continue */ }
    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }
    @Override protected void onDestroy() {
        try { unregisterReceiver(actions); } catch (Exception e) { }
        if (current == this) current = null;
        stopService(new Intent(this, UltraService.class));
        web.destroy();
        super.onDestroy();
    }
}

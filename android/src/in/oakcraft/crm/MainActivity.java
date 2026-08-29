package in.oakcraft.crm;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * OakCraft Sales CRM — Android shell.
 *
 * The web app (index.html, quotation-builder.html, lib/, icons/) is packed inside the APK under
 * assets/www and served to the WebView from a private https origin (APP_ORIGIN) through
 * shouldInterceptRequest. That gives the app a real secure origin (crypto.subtle for password
 * hashing, persistent localStorage shared by both pages) without any network round-trip.
 * Data still lives in the Google Sheet through the Apps Script backend exactly like the web version.
 */
public class MainActivity extends Activity {

    private static final String TAG = "OakCraftCRM";
    static final String APP_HOST = "app.oakcraft.crm";               // fake host, never resolved
    static final String APP_ORIGIN = "https://" + APP_HOST;
    static final String START_URL = APP_ORIGIN + "/index.html";
    private static final int RC_FILE = 1001;
    private static final int RC_STORAGE = 1002;

    /** Remembers the `download` attribute of the last clicked anchor, because WebView's
     *  onDownloadStart() does not reliably pass the suggested file name for blob: URLs. */
    private static final String DL_SHIM =
        "(function(){if(window.__ocDlShim)return;window.__ocDlShim=1;"
        + "function rec(a){try{if(a&&a.download)window.__ocDlName=a.download;}catch(e){}}"
        + "var c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){rec(this);return c.apply(this,arguments);};"
        + "var d=HTMLAnchorElement.prototype.dispatchEvent;HTMLAnchorElement.prototype.dispatchEvent=function(ev){if(ev&&ev.type==='click')rec(this);return d.apply(this,arguments);};"
        + "document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('a[download]'):null;if(a)rec(a);},true);"
        + "window.__ocNative='android';})();";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private long lastBack = 0;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private PendingSave pendingSave;

    private static class PendingSave { String name, mime; byte[] data; }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(web);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " OakCraftCRM/" + versionName() + " (Android)");
        CookieManager.getInstance().setAcceptCookie(true);
        WebView.setWebContentsDebuggingEnabled(false);

        web.addJavascriptInterface(new Bridge(), "OakAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                handleDownload(url, contentDisposition, mimetype);
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        if (web.getUrl() == null) web.loadUrl(START_URL);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { try { web.destroy(); } catch (Exception ignored) {} super.onDestroy(); }

    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "1.0"; }
    }

    /* ----------------------------------------------------------------------------------------
     * Back button: let the page close its own modal / drawer first, then WebView history,
     * then double-press to exit.
     * ---------------------------------------------------------------------------------------- */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(function(){try{return (window.__ocBack&&window.__ocBack())?'1':'0';}catch(e){return '0';}})()",
            new ValueCallback<String>() {
                @Override public void onReceiveValue(String v) {
                    if (v != null && v.indexOf('1') >= 0) return;
                    if (web.canGoBack()) { web.goBack(); return; }
                    long now = System.currentTimeMillis();
                    if (now - lastBack < 2200) { finish(); return; }
                    lastBack = now;
                    Toast.makeText(MainActivity.this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
                }
            });
    }

    /* ----------------------------------------------------------------------------------------
     * WebViewClient: serve bundled assets, route external links to system apps
     * ---------------------------------------------------------------------------------------- */
    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (u != null && APP_HOST.equalsIgnoreCase(u.getHost())) return serveAsset(u);
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
            if (APP_HOST.equalsIgnoreCase(u.getHost())) return false;          // our own pages
            if ("blob".equals(scheme) || "data".equals(scheme) || "about".equals(scheme) || "javascript".equals(scheme)) return false;
            openExternal(url);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            // download-name shim + platform marker (the v9 block in index.html checks window.OakAndroid)
            view.evaluateJavascript(DL_SHIM, null);
        }
    }

    private WebResourceResponse serveAsset(Uri u) {
        String path = u.getPath();
        if (path == null || path.equals("/") || path.length() == 0) path = "/index.html";
        if (path.endsWith("/")) path = path + "index.html";
        String rel = "www" + path;
        AssetManager am = getAssets();
        try {
            InputStream in = am.open(rel);
            Map<String, String> h = new HashMap<String, String>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mimeFor(rel), "utf-8", 200, "OK", h, in);
        } catch (IOException e) {
            Map<String, String> h = new HashMap<String, String>();
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new ByteArrayInputStream("Not found".getBytes()));
        }
    }

    private static String mimeFor(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html") || l.endsWith(".htm")) return "text/html";
        if (l.endsWith(".js")) return "application/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".webmanifest")) return "application/manifest+json";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".webp")) return "image/webp";
        if (l.endsWith(".ico")) return "image/x-icon";
        if (l.endsWith(".woff2")) return "font/woff2";
        if (l.endsWith(".woff")) return "font/woff";
        if (l.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Log.w(TAG, "openExternal failed", e);
        }
    }

    /* ----------------------------------------------------------------------------------------
     * WebChromeClient: file chooser (+ camera), JS dialogs, console
     * ---------------------------------------------------------------------------------------- */
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
            fileCallback = callback;
            String[] accept = params.getAcceptTypes();
            boolean images = false;
            StringBuilder types = new StringBuilder();
            if (accept != null) for (String a : accept) {
                if (a == null || a.trim().length() == 0) continue;
                if (a.startsWith("image/")) images = true;
                if (types.length() > 0) types.append(',');
                types.append(a.trim());
            }
            boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;

            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType(types.length() == 0 ? "*/*" : (types.indexOf(",") >= 0 ? "*/*" : types.toString()));
            if (types.indexOf(",") >= 0) pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toString().split(","));
            if (multiple) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

            List<Intent> extras = new ArrayList<Intent>();
            cameraUri = null;
            if (images || types.length() == 0) {
                try {
                    Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    if (cam.resolveActivity(getPackageManager()) != null) {
                        String name = "camera_" + System.currentTimeMillis() + ".jpg";
                        File f = ShareProvider.fileFor(MainActivity.this, name);
                        try { f.createNewFile(); } catch (IOException ignored) {}
                        cameraUri = ShareProvider.uriFor(name);
                        cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                        cam.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        // The chooser (system UI) starts the camera app, so grant the URI to every camera app explicitly.
                        for (ResolveInfo ri : getPackageManager().queryIntentActivities(cam, 0)) {
                            try { grantUriPermission(ri.activityInfo.packageName, cameraUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) {}
                        }
                        extras.add(cam);
                    }
                } catch (Exception e) { Log.w(TAG, "camera intent", e); cameraUri = null; }
            }
            Intent chooser = Intent.createChooser(pick, getString(R.string.choose_file));
            if (!extras.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toArray(new Intent[extras.size()]));
            try {
                startActivityForResult(chooser, RC_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null; cameraUri = null;
                Toast.makeText(MainActivity.this, R.string.no_app, Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this).setMessage(message).setCancelable(false)
                .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { result.confirm(); } }).show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this).setMessage(message).setCancelable(false)
                .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { result.confirm(); } })
                .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { result.cancel(); } }).show();
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, "[web] " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == RC_FILE) {
            ValueCallback<Uri[]> cb = fileCallback;
            fileCallback = null;
            if (cb == null) return;
            Uri[] out = null;
            if (resultCode == Activity.RESULT_OK) {
                if (data == null || (data.getData() == null && data.getClipData() == null)) {
                    // camera app wrote into our EXTRA_OUTPUT
                    if (cameraUri != null) {
                        File f = ShareProvider.fileFor(this, cameraUri.getLastPathSegment());
                        if (f.exists() && f.length() > 0) out = new Uri[] { cameraUri };
                    }
                } else if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    out = new Uri[n];
                    for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
                } else {
                    out = new Uri[] { data.getData() };
                }
            }
            if (cameraUri != null) { try { revokeUriPermission(cameraUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) {} }
            cameraUri = null;
            cb.onReceiveValue(out);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /* ----------------------------------------------------------------------------------------
     * Downloads (Excel export, PDF quotation, file previews)
     * ---------------------------------------------------------------------------------------- */
    private void handleDownload(String url, String contentDisposition, String mimetype) {
        String name = fileNameFrom(contentDisposition, url, mimetype);
        if (url.startsWith("blob:")) {
            // Fetch the blob inside the page and hand the bytes over through the bridge.
            String js = "(function(){try{var nm=window.__ocDlName||" + jsStr(name) + ";window.__ocDlName='';"
                + "var x=new XMLHttpRequest();x.open('GET','" + url + "',true);x.responseType='blob';"
                + "x.onload=function(){var r=new FileReader();r.onloadend=function(){var s=String(r.result||'');var i=s.indexOf('base64,');"
                + "OakAndroid.saveBase64(nm,x.response.type||" + jsStr(mimetype) + ",i>=0?s.slice(i+7):'');};r.readAsDataURL(x.response);};"
                + "x.onerror=function(){OakAndroid.toast('Download failed');};x.send();}catch(e){OakAndroid.toast('Download failed: '+e.message);}})()";
            web.evaluateJavascript(js, null);
            return;
        }
        if (url.startsWith("data:")) {
            try {
                int i = url.indexOf("base64,");
                String meta = url.substring(5, i < 0 ? url.indexOf(',') : i);
                String mime = meta.indexOf(';') >= 0 ? meta.substring(0, meta.indexOf(';')) : meta;
                byte[] bytes = i >= 0 ? Base64.decode(url.substring(i + 7), Base64.DEFAULT) : Uri.decode(url.substring(url.indexOf(',') + 1)).getBytes("UTF-8");
                if (name.equals("download") || name.indexOf('.') < 0) name = name + "." + extFor(mime);
                saveBytes(name, mime, bytes);
            } catch (Exception e) { Toast.makeText(this, R.string.save_failed, Toast.LENGTH_SHORT).show(); }
            return;
        }
        openExternal(url);   // http(s): let the browser / download manager handle it
    }

    private static String jsStr(String s) {
        if (s == null) return "''";
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'";
    }

    private static String fileNameFrom(String cd, String url, String mime) {
        String name = null;
        if (cd != null) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("filename\\*?=(?:UTF-8'')?\"?([^\";]+)\"?", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(cd);
            if (m.find()) name = Uri.decode(m.group(1).trim());
        }
        if ((name == null || name.length() == 0) && url != null && !url.startsWith("blob:") && !url.startsWith("data:")) {
            String p = Uri.parse(url).getLastPathSegment();
            if (p != null && p.length() > 0) name = p;
        }
        if (name == null || name.length() == 0) name = "download";
        if (name.indexOf('.') < 0 && mime != null) name = name + "." + extFor(mime);
        return ShareProvider.safeName(name);
    }

    private static String extFor(String mime) {
        if (mime == null) return "bin";
        String m = mime.toLowerCase();
        if (m.indexOf("spreadsheetml") >= 0) return "xlsx";
        if (m.indexOf("ms-excel") >= 0) return "xls";
        if (m.indexOf("pdf") >= 0) return "pdf";
        if (m.indexOf("csv") >= 0) return "csv";
        if (m.indexOf("json") >= 0) return "json";
        String e = MimeTypeMap.getSingleton().getExtensionFromMimeType(m);
        return e == null ? "bin" : e;
    }

    /** Write bytes to the public Downloads folder (Android 10+: MediaStore, older: file + permission). */
    private void saveBytes(String name, String mime, byte[] bytes) {
        if (mime == null || mime.length() == 0) mime = "application/octet-stream";
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put("_display_name", name);
                v.put("mime_type", mime);
                v.put("relative_path", Environment.DIRECTORY_DOWNLOADS + "/OakCraft CRM");
                v.put("is_pending", 1);
                Uri col = Uri.parse("content://media/external/downloads");
                Uri item = getContentResolver().insert(col, v);
                if (item == null) throw new IOException("insert failed");
                OutputStream os = getContentResolver().openOutputStream(item);
                os.write(bytes); os.flush(); os.close();
                ContentValues done = new ContentValues(); done.put("is_pending", 0);
                getContentResolver().update(item, done, null, null);
                afterSaved(name, mime, item);
                return;
            }
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                pendingSave = new PendingSave(); pendingSave.name = name; pendingSave.mime = mime; pendingSave.data = bytes;
                requestPermissions(new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, RC_STORAGE);
                return;
            }
            saveLegacy(name, mime, bytes);
        } catch (Exception e) {
            Log.w(TAG, "save failed, falling back to app storage", e);
            saveFallback(name, mime, bytes);
        }
    }

    private void saveLegacy(String name, String mime, byte[] bytes) {
        try {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "OakCraft CRM");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, name);
            int n = 1; String base = name, ext = "";
            int di = name.lastIndexOf('.'); if (di > 0) { base = name.substring(0, di); ext = name.substring(di); }
            while (f.exists()) { f = new File(dir, base + " (" + (n++) + ")" + ext); }
            FileOutputStream os = new FileOutputStream(f); os.write(bytes); os.flush(); os.close();
            // expose through our provider so viewers can open it without file:// URIs
            File shared = ShareProvider.fileFor(this, f.getName());
            copy(f, shared);
            afterSaved(f.getName(), mime, ShareProvider.uriFor(f.getName()));
        } catch (Exception e) {
            Log.w(TAG, "legacy save failed", e);
            saveFallback(name, mime, bytes);
        }
    }

    private void saveFallback(String name, String mime, byte[] bytes) {
        try {
            File f = ShareProvider.fileFor(this, name);
            FileOutputStream os = new FileOutputStream(f); os.write(bytes); os.flush(); os.close();
            afterSaved(f.getName(), mime, ShareProvider.uriFor(f.getName()));
        } catch (Exception e) {
            Toast.makeText(this, R.string.save_failed, Toast.LENGTH_SHORT).show();
        }
    }

    private static void copy(File from, File to) throws IOException {
        InputStream in = new java.io.FileInputStream(from); OutputStream out = new FileOutputStream(to);
        byte[] buf = new byte[65536]; int n; while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close(); out.close();
    }

    private void afterSaved(final String name, final String mime, final Uri uri) {
        ui.post(new Runnable() { @Override public void run() {
            Toast.makeText(MainActivity.this, getString(R.string.saved_to, "Downloads/OakCraft CRM/" + name), Toast.LENGTH_LONG).show();
            try {
                Intent view = new Intent(Intent.ACTION_VIEW);
                view.setDataAndType(uri, mime);
                view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType(mime); share.putExtra(Intent.EXTRA_STREAM, uri);
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(view.resolveActivity(getPackageManager()) != null ? view : share, name);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(chooser);
            } catch (Exception e) { Log.w(TAG, "open after save", e); }
        } });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == RC_STORAGE && pendingSave != null) {
            PendingSave p = pendingSave; pendingSave = null;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) saveLegacy(p.name, p.mime, p.data);
            else saveFallback(p.name, p.mime, p.data);
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    /* ----------------------------------------------------------------------------------------
     * JS bridge  (window.OakAndroid)
     * ---------------------------------------------------------------------------------------- */
    private class Bridge {
        @JavascriptInterface public void openExternal(final String url) {
            ui.post(new Runnable() { @Override public void run() { MainActivity.this.openExternal(url); } });
        }
        @JavascriptInterface public void toast(final String msg) {
            ui.post(new Runnable() { @Override public void run() { Toast.makeText(MainActivity.this, msg == null ? "" : msg, Toast.LENGTH_SHORT).show(); } });
        }
        @JavascriptInterface public void saveBase64(final String name, final String mime, final String b64) {
            ui.post(new Runnable() { @Override public void run() {
                try {
                    byte[] bytes = Base64.decode(b64 == null ? "" : b64, Base64.DEFAULT);
                    String n = ShareProvider.safeName(name == null || name.length() == 0 ? "download" : name);
                    if (n.indexOf('.') < 0) n = n + "." + extFor(mime);
                    saveBytes(n, mime, bytes);
                } catch (Exception e) { Toast.makeText(MainActivity.this, R.string.save_failed, Toast.LENGTH_SHORT).show(); }
            } });
        }
        @JavascriptInterface public String getVersion() { return versionName(); }
        @JavascriptInterface public int getVersionCode() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception e) { return 0; }
        }
        @JavascriptInterface public String getPlatform() { return "android"; }
    }
}

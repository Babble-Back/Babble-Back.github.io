package com.backtalk.android;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.backtalk.local";
    private static final String APP_ORIGIN = "https://" + APP_HOST;
    private static final String START_URL = APP_ORIGIN + "/";
    private static final int REQUEST_RECORD_AUDIO = 1001;

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(11, 18, 32));
        getWindow().setNavigationBarColor(Color.rgb(11, 18, 32));

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);

        configureWebView();
        configureServiceWorkerAssetLoading();

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setUserAgentString(settings.getUserAgentString() + " BabbleBackAndroid/1.0");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        boolean isDebuggable =
            (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(isDebuggable);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                WebView view,
                WebResourceRequest request
            ) {
                return createAssetResponse(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isAppAssetUrl(uri)) {
                    return false;
                }

                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    openExternalUrl(uri);
                    return true;
                }

                if ("mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme)) {
                    openExternalUrl(uri);
                    return true;
                }

                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }
        });
    }

    private void configureServiceWorkerAssetLoading() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return;
        }

        ServiceWorkerController controller = ServiceWorkerController.getInstance();
        controller.getServiceWorkerWebSettings().setAllowContentAccess(false);
        controller.getServiceWorkerWebSettings().setAllowFileAccess(false);
        controller.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return createAssetResponse(request);
            }
        });
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        String origin = request.getOrigin() == null ? "" : request.getOrigin().toString();
        if (!origin.startsWith(APP_ORIGIN)) {
            request.deny();
            return;
        }

        boolean wantsAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                wantsAudio = true;
                break;
            }
        }

        if (!wantsAudio) {
            request.deny();
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            return;
        }

        pendingPermissionRequest = request;
        requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQUEST_RECORD_AUDIO);
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        String[] permissions,
        int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode != REQUEST_RECORD_AUDIO || pendingPermissionRequest == null) {
            return;
        }

        PermissionRequest request = pendingPermissionRequest;
        pendingPermissionRequest = null;

        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            request.deny();
        }
    }

    private WebResourceResponse createAssetResponse(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!isAppAssetUrl(uri)) {
            return null;
        }

        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return null;
        }

        String assetPath = assetPathFor(uri);
        WebResourceResponse response = openAssetResponse(assetPath);

        if (response == null && shouldFallbackToIndex(uri)) {
            response = openAssetResponse("www/index.html");
        }

        return response;
    }

    private boolean isAppAssetUrl(Uri uri) {
        return uri != null &&
            "https".equalsIgnoreCase(uri.getScheme()) &&
            APP_HOST.equalsIgnoreCase(uri.getHost());
    }

    private String assetPathFor(Uri uri) {
        String path = uri.getPath();
        if (path == null || path.length() == 0 || "/".equals(path)) {
            return "www/index.html";
        }

        String cleanPath = path.startsWith("/") ? path.substring(1) : path;
        cleanPath = Uri.decode(cleanPath);

        if (cleanPath.contains("..")) {
            return "www/index.html";
        }

        if (cleanPath.endsWith("/")) {
            cleanPath = cleanPath + "index.html";
        }

        return "www/" + cleanPath;
    }

    private boolean shouldFallbackToIndex(Uri uri) {
        String path = uri.getPath();
        return path == null || !path.substring(path.lastIndexOf('/') + 1).contains(".");
    }

    private WebResourceResponse openAssetResponse(String assetPath) {
        try {
            InputStream stream = getAssets().open(assetPath);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", APP_ORIGIN);
            headers.put("Cache-Control", "no-cache");

            return new WebResourceResponse(
                mimeTypeFor(assetPath),
                null,
                200,
                "OK",
                headers,
                stream
            );
        } catch (IOException ignored) {
            return null;
        }
    }

    private String mimeTypeFor(String path) {
        String lowerPath = path.toLowerCase(Locale.US);
        if (lowerPath.endsWith(".html")) {
            return "text/html";
        }
        if (lowerPath.endsWith(".js")) {
            return "text/javascript";
        }
        if (lowerPath.endsWith(".css")) {
            return "text/css";
        }
        if (lowerPath.endsWith(".json")) {
            return "application/json";
        }
        if (lowerPath.endsWith(".webmanifest")) {
            return "application/manifest+json";
        }
        if (lowerPath.endsWith(".wasm")) {
            return "application/wasm";
        }
        if (lowerPath.endsWith(".png")) {
            return "image/png";
        }
        if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (lowerPath.endsWith(".svg")) {
            return "image/svg+xml";
        }
        if (lowerPath.endsWith(".ico")) {
            return "image/x-icon";
        }
        if (lowerPath.endsWith(".txt")) {
            return "text/plain";
        }
        return "application/octet-stream";
    }

    private void openExternalUrl(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // No installed app can handle the URL.
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

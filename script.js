// ════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════
$(function () {
    $("#categories").select2({
        theme: "bootstrap-5",
        placeholder: "Select categories...",
        allowClear: true,
        dropdownParent: $("body"),
    });

    $("#appLang").select2({
        theme: "bootstrap-5",
        dropdownParent: $("body"),
        minimumResultsForSearch: 0
    });

    $("#appLang").trigger("change.select2");

    // Accessible name for Select2's generated selection
    $('select.select2-hidden-accessible').each(function () {
        const $select = $(this);
        const ariaLabel = $select.attr('aria-label');

        if (ariaLabel) {
            $select
                .next('.select2')
                .find('.select2-selection')
                .attr('aria-label', ariaLabel);
        }
    });

    // Fix Select2 search field ARIA
    $(document).on('select2:open', function () {
        $('.select2-search__field')
            .removeAttr('role')
            .removeAttr('aria-autocomplete');
    });
});


// ════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════
let imageFile = null,
    imageDataURL = null,
    imgW = 0,
    imgH = 0;
let srcCanvas = null; // master canvas

// ════════════════════════════════════════════════════
// PERSISTENCE (sessionStorage)
// ════════════════════════════════════════════════════
const PERSIST_FIELDS = [
    "appName",
    "shortName",
    "description",
    "startUrl",
    "iconPath",
    "appVersion",
    "appAuthor",
    "scope",
    "appId",
    "iarc",
    "tagline",
    "playStoreId",
    "appStoreId",
    "themeColorHex",
    "bgColorHex",
    "display",
    "orientation",
    "dir",
];

function saveState() {
    const data = {};
    PERSIST_FIELDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) data[id] = el.value;
    });
    data.categories = $("#categories").val();
    data.appLang = $("#appLang").val();
    data.preferRelatedApps = document.getElementById("preferRelatedApps").checked;
    data.includeShareTarget = document.getElementById("includeShareTarget").checked;
    data.includeProtocolHandlers = document.getElementById("includeProtocolHandlers").checked;
    data.genMaskable = document.getElementById("genMaskable").checked;
    data.genSplash = document.getElementById("genSplash").checked;
    data.shortcuts = getShortcutsData();
    try {
        sessionStorage.setItem("pwa-maker-state", JSON.stringify(data));
    } catch (e) {}
}

function restoreState() {
    try {
        const raw = sessionStorage.getItem("pwa-maker-state");
        if (!raw) return;
        const data = JSON.parse(raw);
        PERSIST_FIELDS.forEach((id) => {
            const el = document.getElementById(id);
            if (el && data[id] !== undefined) el.value = data[id];
        });
        if (data.categories) {
            $("#categories").val(data.categories).trigger("change");
        }
        if (data.appLang) {
            $("#appLang").val(data.appLang).trigger("change.select2");
        }
        ["preferRelatedApps", "includeShareTarget", "includeProtocolHandlers", "genMaskable", "genSplash"].forEach(
            (id) => {
                if (data[id] !== undefined) document.getElementById(id).checked = data[id];
            }
        );
        if (data.shortcuts) {
            data.shortcuts.forEach((s) => addShortcut(s));
        }
        // sync color pickers
        syncColorPicker("theme");
        syncColorPicker("bg");
        updateAllCounters();
        updateLivePreview();
    } catch (e) {}
}

// ════════════════════════════════════════════════════
// DROP ZONE
// ════════════════════════════════════════════════════
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("iconFile");
dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) loadImage(f);
});
fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) loadImage(fileInput.files[0]);
});
document.getElementById("removeIcon").addEventListener("click", removeImage);

function loadImage(file) {
    imageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        imageDataURL = e.target.result;
        const img = new Image();
        img.onload = () => {
            imgW = img.width;
            imgH = img.height;
            srcCanvas = document.createElement("canvas");
            srcCanvas.width = imgW;
            srcCanvas.height = imgH;
            srcCanvas.getContext("2d").drawImage(img, 0, 0);
            document.getElementById("previewImg").src = imageDataURL;
            document.getElementById("previewName").textContent = file.name;
            document.getElementById("previewSize").textContent = formatBytes(file.size);
            document.getElementById("previewDims").textContent =
                `${imgW}×${imgH}px${imgW < 512 || imgH < 512 ? " ⚠️ Recomendado 512px+" : " ✅"}`;
            document.getElementById("previewContainer").style.display = "flex";
            dropZone.style.display = "none";
            document.getElementById("generateBtn").disabled = false;
            document.getElementById("generateHint").style.display = "none";
            extractColors(img);
            renderMaskablePreviews();
        };
        img.src = imageDataURL;
    };
    reader.readAsDataURL(file);
}

function removeImage() {
    imageFile = null;
    imageDataURL = null;
    srcCanvas = null;
    document.getElementById("previewContainer").style.display = "none";
    document.getElementById("maskablePreview").classList.remove("show");
    dropZone.style.display = "";
    fileInput.value = "";
    document.getElementById("generateBtn").disabled = true;
    document.getElementById("generateHint").style.display = "";
}

function formatBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
}

// ════════════════════════════════════════════════════
// MASKABLE PREVIEW
// ════════════════════════════════════════════════════
function renderMaskablePreviews() {
    if (!srcCanvas) return;
    document.getElementById("maskablePreview").classList.add("show");
    // Draw maskable (80% icon centered on bg color)
    const SIZE = 64;
    const canvases = {
        maskCircle: document.getElementById("maskCircle"),
        maskSquircle: document.getElementById("maskSquircle"),
        maskSquare: document.getElementById("maskSquare"),
        maskFull: document.getElementById("maskFull"),
    };
    const bg = document.getElementById("bgColorHex").value || "#ffffff";
    Object.values(canvases).forEach((c) => {
        const ctx = c.getContext("2d");
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, SIZE, SIZE);
        // icon at 80% (safe zone)
        const pad = SIZE * 0.1;
        const iconSize = SIZE * 0.8;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(srcCanvas, pad, pad, iconSize, iconSize);
    });
}

// ════════════════════════════════════════════════════
// COLOR EXTRACTION
// ════════════════════════════════════════════════════
function extractColors(img) {
    const canvas = document.createElement("canvas");
    const SIZE = 100;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const buckets = {};
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i],
            g = data[i + 1],
            b = data[i + 2],
            a = data[i + 3];
        if (a < 128) continue;
        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
        if (brightness > 240 || brightness < 15) continue;
        const qr = Math.round(r / 32) * 32,
            qg = Math.round(g / 32) * 32,
            qb = Math.round(b / 32) * 32;
        const key = `${qr},${qg},${qb}`;
        buckets[key] = (buckets[key] || 0) + 1;
    }
    const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return;
    const [r1, g1, b1] = sorted[0][0].split(",").map(Number);
    setColor("bg", rgbToHex(r1, g1, b1));
    document.getElementById("bgBadge").textContent = "auto ✓";
    let secondColor = null;
    for (const thresh of [100, 80, 60, 40]) {
        for (let i = 1; i < sorted.length; i++) {
            const [r, g, b] = sorted[i][0].split(",").map(Number);
            const dr = (r - r1) * 0.299,
                dg = (g - g1) * 0.587,
                db = (b - b1) * 0.114;
            if (Math.sqrt(dr * dr + dg * dg + db * db) * 3 >= thresh) {
                secondColor = rgbToHex(r, g, b);
                break;
            }
        }
        if (secondColor) break;
    }
    if (!secondColor || secondColor === rgbToHex(r1, g1, b1)) {
        const hsl = rgbToHsl(r1, g1, b1);
        const [cr, cg, cb] = hslToRgb((hsl[0] + 180) % 360, hsl[1], hsl[2]);
        secondColor = rgbToHex(cr, cg, cb);
    }
    setColor("theme", secondColor);
    document.getElementById("themeBadge").textContent = "auto ✓";
    renderMaskablePreviews();
}

function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("");
}
function setColor(which, hex) {
    document.getElementById(which + "ColorPicker").value = hex;
    document.getElementById(which + "ColorHex").value = hex;
}
function syncColorPicker(which) {
    const hex = document.getElementById(which + "ColorHex").value;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) document.getElementById(which + "ColorPicker").value = hex;
}
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    let h,
        s,
        l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            default:
                h = ((r - g) / d + 4) / 6;
        }
    }
    return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
    h /= 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
        p = 2 * l - q,
        hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    ];
}

["theme", "bg"].forEach((w) => {
    document.getElementById(w + "ColorPicker").addEventListener("input", () => {
        document.getElementById(w + "ColorHex").value = document.getElementById(w + "ColorPicker").value;
        renderMaskablePreviews();
        updateLivePreview();
    });
    document.getElementById(w + "ColorHex").addEventListener("input", () => {
        const hex = document.getElementById(w + "ColorHex").value;
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
            document.getElementById(w + "ColorPicker").value = hex;
            renderMaskablePreviews();
            updateLivePreview();
        }
    });
});

// ════════════════════════════════════════════════════
// CHAR COUNTERS
// ════════════════════════════════════════════════════
function setupCounter(inputId, countId, max) {
    const el = document.getElementById(inputId),
        counter = document.getElementById(countId);
    if (!el || !counter) return;
    function update() {
        const len = el.value.length;
        counter.textContent = `${len} / ${max}`;
        counter.className = "char-count" + (len > max * 0.9 ? (len >= max ? " danger" : " warning") : "");
    }
    el.addEventListener("input", () => {
        update();
        updateLivePreview();
        saveState();
    });
    update();
}
function updateAllCounters() {
    setupCounter("appName", "nameCount", 45);
    setupCounter("shortName", "shortCount", 12);
    setupCounter("description", "descCount", 300);
}
updateAllCounters();

// Live preview trigger for all fields
[
    "startUrl",
    "iconPath",
    "appVersion",
    "appAuthor",
    "scope",
    "appId",
    "iarc",
    "tagline",
    "playStoreId",
    "appStoreId",
    "display",
    "orientation",
    "dir",
].forEach((id) => {
    const el = document.getElementById(id);
    if (el)
        el.addEventListener("input", () => {
            updateLivePreview();
            saveState();
        });
});
["preferRelatedApps", "includeShareTarget", "includeProtocolHandlers", "genMaskable", "genSplash"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
        updateLivePreview();
        saveState();
    });
});
$("#categories,#appLang").on("change", () => {
    updateLivePreview();
    saveState();
});

// ════════════════════════════════════════════════════
// URL VALIDATION
// ════════════════════════════════════════════════════
document.getElementById("startUrl").addEventListener("blur", validateUrl);
function validateUrl() {
    const el = document.getElementById("startUrl");
    const err = document.getElementById("urlError");
    const val = el.value.trim();
    if (!val) {
        el.classList.remove("is-invalid", "is-valid");
        err.classList.remove("show");
        return true;
    }
    const valid = /^https?:\/\/.+/.test(val);
    el.classList.toggle("is-invalid", !valid);
    el.classList.toggle("is-valid", valid);
    err.classList.toggle("show", !valid);
    return valid;
}

// ════════════════════════════════════════════════════
// SHORTCUTS
// ════════════════════════════════════════════════════
let shortcutCount = 0;
function addShortcut(data = {}) {
    if (shortcutCount >= 4) {
        showToast("Máximo de 4 shortcuts permitidos.", "error");
        return;
    }
    shortcutCount++;
    const id = shortcutCount;
    const html = `<div class="shortcut-item" id="shortcut-${id}">
    <button class="btn-remove-shortcut" onclick="removeShortcut(${id})">✕</button>
    <div class="row g-2">
      <div class="col-md-5"><label>Nome</label><input type="text" class="form-control sc-name" placeholder="Ex: Nova Tarefa" value="${esc(data.name || "")}"></div>
      <div class="col-md-4"><label>URL</label><input type="text" class="form-control sc-url" placeholder="/novo" value="${esc(data.url || "")}"></div>
      <div class="col-md-3"><label>Descrição</label><input type="text" class="form-control sc-desc" placeholder="Opcional" value="${esc(data.description || "")}"></div>
    </div>
  </div>`;
    document.getElementById("shortcutsList").insertAdjacentHTML("beforeend", html);
    document.querySelectorAll(".shortcut-item input").forEach((el) =>
        el.addEventListener("input", () => {
            updateLivePreview();
            saveState();
        })
    );
    updateLivePreview();
    saveState();
}
function removeShortcut(id) {
    document.getElementById("shortcut-" + id).remove();
    shortcutCount = Math.max(0, shortcutCount - 1);
    updateLivePreview();
    saveState();
}
function getShortcutsData() {
    return Array.from(document.querySelectorAll(".shortcut-item"))
        .map((el) => ({
            name: el.querySelector(".sc-name").value.trim(),
            url: el.querySelector(".sc-url").value.trim(),
            description: el.querySelector(".sc-desc").value.trim(),
        }))
        .filter((s) => s.name || s.url);
}
document.getElementById("addShortcut").addEventListener("click", () => addShortcut());

// ════════════════════════════════════════════════════
// MANIFEST BUILDER
// ════════════════════════════════════════════════════
function buildManifest() {
    const name = v("appName") || "My PWA";
    const shortName = v("shortName") || name.substring(0, 12);
    const desc = v("description") || "";
    const startUrl = v("startUrl") || "/";
    const themeColor = v("themeColorHex") || "#000000";
    const bgColor = v("bgColorHex") || "#ffffff";
    const display = v("display") || "standalone";
    const orientation = v("orientation") || "any";
    const scope = v("scope") || startUrl;
    const lang = v("appLang") || "en";
    const dir = v("dir") || "auto";
    const iarc = v("iarc");
    const appId = v("appId");
    const iconPrefix = v("iconPath").replace(/\/$/, "") + "/";
    const iconPfx = iconPrefix === "/" ? "" : iconPrefix;

    const iconSizes = [16, 32, 64, 128, 192, 256, 512];
    const icons = iconSizes.map((s) => ({
        src: `${iconPfx}icon-${s}.png`,
        sizes: `${s}x${s}`,
        type: "image/png",
        purpose: "any",
    }));
    if (document.getElementById("genMaskable").checked) {
        icons.push({
            src: `${iconPfx}icon-maskable-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
        });
    }

    const manifest = {
        name,
        short_name: shortName,
        description: desc,
        start_url: startUrl,
        scope,
        id: appId || undefined,
        display,
        orientation,
        theme_color: themeColor,
        background_color: bgColor,
        lang,
        dir,
        icons,
    };
    if (document.getElementById("genMaskable").checked || true) {
        manifest.screenshots = [
            { src: `${iconPfx}social-preview-github.png`, sizes: "1280x640", type: "image/png", form_factor: "wide" },
            { src: `${iconPfx}icon-512.png`, sizes: "512x512", type: "image/png", form_factor: "narrow" },
        ];
    }
    const cats = $("#categories").val() || [];
    if (cats.length) manifest.categories = cats;
    if (iarc) manifest.iarc_rating_id = iarc;
    if (document.getElementById("preferRelatedApps").checked) manifest.prefer_related_applications = true;

    const relatedApps = [];
    const playId = v("playStoreId");
    const appleId = v("appStoreId");
    if (playId)
        relatedApps.push({
            platform: "play",
            url: `https://play.google.com/store/apps/details?id=${playId}`,
            id: playId,
        });
    if (appleId) relatedApps.push({ platform: "itunes", url: `https://apps.apple.com/app/id${appleId}`, id: appleId });
    if (relatedApps.length) manifest.related_applications = relatedApps;

    const shortcuts = getShortcutsData()
        .slice(0, 4)
        .map((s) => ({
            name: s.name || "Shortcut",
            url: s.url || "/",
            ...(s.description ? { description: s.description } : {}),
            icons: [{ src: `${iconPfx}icon-192.png`, sizes: "192x192" }],
        }));
    if (shortcuts.length) manifest.shortcuts = shortcuts;

    if (document.getElementById("includeShareTarget").checked) {
        manifest.share_target = {
            action: "/",
            method: "GET",
            enctype: "application/x-www-form-urlencoded",
            params: { title: "title", text: "text", url: "url" },
        };
    }
    if (document.getElementById("includeProtocolHandlers").checked) {
        manifest.protocol_handlers = [{ protocol: "web+app", url: `${startUrl}?protocol=%s` }];
    }
    // Clean undefined
    Object.keys(manifest).forEach((k) => manifest[k] === undefined && delete manifest[k]);
    return manifest;
}

// ════════════════════════════════════════════════════
// LIVE PREVIEW
// ════════════════════════════════════════════════════
let liveTimer = null;
function updateLivePreview() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
        try {
            const m = buildManifest();
            document.getElementById("liveManifest").innerHTML = syntaxHL(JSON.stringify(m, null, 2), "json");
        } catch (e) {}
    }, 150);
}
updateLivePreview();

// ════════════════════════════════════════════════════
// CANVAS HELPERS
// ════════════════════════════════════════════════════
function resizeCanvas(src, w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return c;
}
function canvasToBuffer(canvas, type = "image/png") {
    return new Promise((res) => canvas.toBlob((b) => res(b.arrayBuffer()), type));
}

// Maskable: icon at 80% centered on bg
function buildMaskableCanvas(src, size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = document.getElementById("bgColorHex").value || "#ffffff";
    ctx.fillRect(0, 0, size, size);
    const pad = size * 0.1,
        iconSize = size * 0.8;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, pad, pad, iconSize, iconSize);
    return c;
}

// Build ICO (16+32 embedded)
async function buildIco(src) {
    const sizes = [16, 32];
    const images = await Promise.all(
        sizes.map(async (s) => {
            const c = resizeCanvas(src, s, s);
            const ab = await canvasToBuffer(c);
            return { size: s, data: new Uint8Array(ab) };
        })
    );
    const headerSize = 6 + images.length * 16;
    let offset = headerSize;
    const infos = images.map((img) => {
        const info = { offset, size: img.data.length };
        offset += img.data.length;
        return info;
    });
    const buf = new Uint8Array(offset);
    const view = new DataView(buf.buffer);
    view.setUint16(0, 0, true);
    view.setUint16(2, 1, true);
    view.setUint16(4, images.length, true);
    images.forEach((img, i) => {
        const base = 6 + i * 16;
        view.setUint8(base, img.size);
        view.setUint8(base + 1, img.size);
        view.setUint8(base + 2, 0);
        view.setUint8(base + 3, 0);
        view.setUint16(base + 4, 1, true);
        view.setUint16(base + 6, 32, true);
        view.setUint32(base + 8, infos[i].size, true);
        view.setUint32(base + 12, infos[i].offset, true);
        buf.set(img.data, infos[i].offset);
    });
    return buf.buffer;
}

// Social preview 1280×640
function buildSocialPreview(src) {
    const W = 1280,
        H = 640;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = document.getElementById("bgColorHex").value || "#ffffff";
    ctx.fillRect(0, 0, W, H);
    const scale = Math.min(W / src.width, H / src.height);
    const dw = src.width * scale,
        dh = src.height * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return c;
}

// Apple splash screens (key sizes)
const SPLASH_SIZES = [
    { w: 2048, h: 2732, label: 'iPad Pro 12.9" (2x)' },
    { w: 1668, h: 2388, label: 'iPad Pro 11" (2x)' },
    { w: 1536, h: 2048, label: 'iPad 10.2" (2x)' },
    { w: 1290, h: 2796, label: "iPhone 14 Pro Max" },
    { w: 1179, h: 2556, label: "iPhone 14 Pro" },
    { w: 1170, h: 2532, label: "iPhone 13/14" },
    { w: 1080, h: 1920, label: "iPhone 8 Plus" },
    { w: 750, h: 1334, label: "iPhone 8" },
];

function buildSplash(src, w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = document.getElementById("bgColorHex").value || "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const size = Math.min(w, h) * 0.35;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, (w - size) / 2, (h - size) / 2, size, size);
    return c;
}

// ════════════════════════════════════════════════════
// BROWSERCONFIG.XML
// ════════════════════════════════════════════════════
function buildBrowserConfig(manifest, iconPfx) {
    return `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square70x70logo src="${iconPfx}icon-64.png"/>
      <square150x150logo src="${iconPfx}icon-128.png"/>
      <square310x310logo src="${iconPfx}icon-256.png"/>
      <wide310x150logo src="${iconPfx}social-preview-github.png"/>
      <TileColor>${manifest.background_color}</TileColor>
    </tile>
    <notification>
      <polling-uri src="${manifest.start_url}notifications/feed.xml"/>
      <frequency>30</frequency>
      <cycle>1</cycle>
    </notification>
  </msapplication>
</browserconfig>`;
}

// ════════════════════════════════════════════════════
// HUMANS.TXT
// ════════════════════════════════════════════════════
function buildHumansTxt(manifest) {
    const author = v("appAuthor") || manifest.name;
    const now = new Date().toISOString().split("T")[0];
    return `/* TEAM */
  Developer / Designer: ${author}
  Site: ${manifest.start_url}

/* THANKS */
  Generated with PWA Maker
  https://github.com/

/* SITE */
  Last update: ${now}
  Language: ${manifest.lang}
  Standards: HTML5, CSS3, Service Worker, Web App Manifest
  Components: Progressive Web App (PWA)
`;
}

// ════════════════════════════════════════════════════
// ROBOTS.TXT + SITEMAP.XML
// ════════════════════════════════════════════════════
function buildRobotsTxt(startUrl) {
    const base = startUrl.replace(/\/$/, "");
    return `User-agent: *
Allow: /

# Sitemaps
Sitemap: ${base}/sitemap.xml

# Common crawl exclusions (adjust as needed)
Disallow: /admin/
Disallow: /api/
Disallow: /*.json$
`;
}

function buildSitemapXml(startUrl) {
    const now = new Date().toISOString().split("T")[0];
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${startUrl}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <!-- Add more URLs here -->
</urlset>`;
}

// ════════════════════════════════════════════════════
// OFFLINE.HTML
// ════════════════════════════════════════════════════
function buildOfflineHtml(manifest) {
    const name = manifest.name || "App";
    const themeColor = manifest.theme_color || "#7c6af7";
    const bgColor = manifest.background_color || "#0a0a0f";
    const iconPfx = v("iconPath").replace(/\/$/, "") + "/";
    const ip = iconPfx === "/" ? "" : iconPfx;
    return `<!DOCTYPE html>
<html lang="${manifest.lang || "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} — Offline</title>
  <meta name="theme-color" content="${themeColor}">
  <link rel="icon" href="${ip}favicon.ico">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:${bgColor};color:#e8e8f0;font-family:system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem;gap:1.5rem}
    .icon{width:80px;height:80px;object-fit:contain;border-radius:16px;opacity:.8}
    .emoji{font-size:4rem}
    h1{font-size:1.75rem;font-weight:700;color:#fff}
    p{color:#9999b3;font-size:1rem;max-width:340px;line-height:1.6}
    .btn{display:inline-block;margin-top:.5rem;background:${themeColor};color:#fff;border:none;padding:.75rem 1.75rem;border-radius:8px;font-size:1rem;cursor:pointer;text-decoration:none;font-family:inherit;transition:opacity .2s}
    .btn:hover{opacity:.85}
    .status{font-size:.8rem;color:#6b6b8a;margin-top:1rem}
  </style>
</head>
<body>
  <div class="emoji">📡</div>
  <img src="${ip}icon-192.png" class="icon" alt="${name}" onerror="this.style.display='none'">
  <h1>${name}</h1>
  <p>Você está offline. Verifique sua conexão com a internet e tente novamente.</p>
  <button class="btn" onclick="window.location.reload()">↺ Tentar novamente</button>
  <p class="status" id="status"></p>
  <script>
    window.addEventListener('online', () => window.location.reload());
    document.getElementById('status').textContent =
      'Última tentativa: ' + new Date().toLocaleTimeString();
  <\/script>
</body>
</html>`;
}

// ════════════════════════════════════════════════════
// SERVICE WORKER
// ════════════════════════════════════════════════════
function buildServiceWorker(manifest) {
    const appName = manifest.name || "My PWA";
    const version = v("appVersion") || "1.0.0";
    const startUrl = manifest.start_url || "/";
    const themeColor = manifest.theme_color || "#000000";
    const cacheName = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-v" + version;
    const iconPfx = v("iconPath").replace(/\/$/, "") + "/";
    const ip = iconPfx === "/" ? "" : iconPfx;
    const iconFiles = [16, 32, 64, 128, 192, 256, 512].map((s) => `'${ip}icon-${s}.png'`);
    if (document.getElementById("genMaskable").checked) iconFiles.push(`'${ip}icon-maskable-512.png'`);

    return `// ════════════════════════════════════════════════════
// Service Worker — ${appName}
// Generated by PWA Maker · v${version}
// Cache: ${cacheName}
// ════════════════════════════════════════════════════

const CACHE_NAME  = '${cacheName}';
const OFFLINE_URL = 'offline.html';

// Files to pre-cache on install
const PRECACHE_URLS = [
  '/',
  'index.html',
  'offline.html',
  'manifest.json',
  'favicon.ico',
  'browserconfig.xml',
  '${ip}social-preview-github.png',
${iconFiles.map((f) => "  " + f + ",").join("\n")}
  // Add your CSS, JS and other static assets:
  // 'styles.css',
  // 'app.js',
];

// ── Install ───────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Install · cache:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Could not cache:', url, err)
          )
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activate · removing old caches');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  if (event.request.url.includes('browser-sync')) return;

  const url = new URL(event.request.url);

  // HTML navigation → Network first, cache fallback, offline page
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(networkFirstWithOffline(event.request));
    return;
  }

  // Images / fonts / icons → Cache first, then network
  if (isStaticAsset(event.request, url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Scripts & styles → Stale-while-revalidate
  if (isScriptOrStyle(event.request, url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Everything else → Network first
  event.respondWith(networkFirst(event.request));
});

// ── Strategies ────────────────────────────────────
async function networkFirstWithOffline(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || networkFetch;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return await caches.match(request) ||
      new Response('', { status: 408, statusText: 'Offline' });
  }
}

// ── Helpers ───────────────────────────────────────
function isStaticAsset(req, url) {
  return req.destination === 'image' ||
    req.destination === 'font' ||
    /\\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot)$/i.test(url.pathname);
}
function isScriptOrStyle(req, url) {
  return req.destination === 'script' ||
    req.destination === 'style' ||
    /\\.(js|css)$/i.test(url.pathname);
}

// ── Background Sync ───────────────────────────────
self.addEventListener('sync', event => {
  console.log('[SW] Sync:', event.tag);
  if (event.tag === 'sync-data') {
    event.waitUntil(syncPendingData());
  }
});
async function syncPendingData() {
  // Read from IndexedDB and POST to server
  console.log('[SW] Syncing pending data...');
}

// ── Push Notifications ────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || '${appName}', {
      body:    data.body    || 'You have a new notification.',
      icon:    data.icon    || '${ip}icon-192.png',
      badge:   data.badge   || '${ip}icon-64.png',
      image:   data.image,
      tag:     data.tag     || 'default',
      data:    data.url     || '${startUrl}',
      vibrate: [100, 50, 100],
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data || '${startUrl}';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Messages ──────────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[SW] ${appName} loaded · cache:', CACHE_NAME);
`;
}

// ════════════════════════════════════════════════════
// HTML HEAD CODE
// ════════════════════════════════════════════════════
function buildHeadCode(manifest) {
    const name = manifest.name,
        desc = manifest.description || "",
        url = manifest.start_url;
    const themeColor = manifest.theme_color,
        shortName = manifest.short_name;
    const lang = manifest.lang || "en",
        author = v("appAuthor") || name;
    const langEl = document.getElementById("appLang");
    const locale = langEl.options[langEl.selectedIndex]?.getAttribute("data-locale") || "en_US";
    const iconPfx = v("iconPath").replace(/\/$/, "") + "/";
    const ip = iconPfx === "/" ? "" : iconPfx;
    const base = url.replace(/\/$/, "");
    const socialUrl = `${base}/${ip}social-preview-github.png`;
    const iconUrl = `${base}/${ip}icon-512.png`;
    const version = v("appVersion") || "1.0";

    const lines = [
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Primary Meta Tags                              -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<meta charset="UTF-8">`,
        `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
        `<title>${esc(name)}</title>`,
        `<meta name="title" content="${esc(name)}">`,
        `<meta name="description" content="${esc(desc)}">`,
        `<meta name="keywords" content="${esc((manifest.categories || []).join(", "))}">`,
        `<meta name="author" content="${esc(author)}">`,
        `<meta name="language" content="${esc(lang)}">`,
        `<meta name="robots" content="index, follow">`,
        `<meta name="revisit-after" content="7 days">`,
        `<meta name="generator" content="PWA Maker">`,
        `<link rel="canonical" href="${esc(url)}">`,
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Open Graph / Facebook / LinkedIn / WhatsApp    -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:url" content="${esc(url)}">`,
        `<meta property="og:title" content="${esc(name)}">`,
        `<meta property="og:description" content="${esc(desc)}">`,
        `<meta property="og:image" content="${esc(socialUrl)}">`,
        `<meta property="og:image:secure_url" content="${esc(socialUrl)}">`,
        `<meta property="og:image:type" content="image/png">`,
        `<meta property="og:image:width" content="1280">`,
        `<meta property="og:image:height" content="640">`,
        `<meta property="og:image:alt" content="${esc(name)}">`,
        `<meta property="og:locale" content="${esc(locale)}">`,
        `<meta property="og:site_name" content="${esc(name)}">`,
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Twitter / X                                    -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:site" content="@yourhandle">`,
        `<meta name="twitter:creator" content="@yourhandle">`,
        `<meta name="twitter:url" content="${esc(url)}">`,
        `<meta name="twitter:title" content="${esc(name)}">`,
        `<meta name="twitter:description" content="${esc(desc)}">`,
        `<meta name="twitter:image" content="${esc(socialUrl)}">`,
        `<meta name="twitter:image:alt" content="${esc(name)}">`,
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Pinterest                                      -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<meta name="pinterest-rich-pin" content="true">`,
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Microsoft / Windows / Edge                     -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<meta name="msapplication-TileColor" content="${esc(manifest.background_color)}">`,
        `<meta name="msapplication-TileImage" content="${esc(ip)}icon-192.png">`,
        `<meta name="msapplication-tooltip" content="${esc(desc)}">`,
        `<meta name="msapplication-starturl" content="${esc(url)}">`,
        `<meta name="msapplication-navbutton-color" content="${esc(themeColor)}">`,
        `<meta name="msapplication-config" content="browserconfig.xml">`,
        `<meta name="msapplication-task" content="name=${esc(name)};action-uri=${esc(url)};icon-uri=${esc(ip)}icon-32.png">`,
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Apple / iOS / Safari                           -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<meta name="apple-mobile-web-app-capable" content="yes">`,
        `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
        `<meta name="apple-mobile-web-app-title" content="${esc(shortName)}">`,
        `<meta name="format-detection" content="telephone=no">`,
    ];

    // Apple splash screens
    if (document.getElementById("genSplash").checked) {
        lines.push(`<!-- Apple Splash Screens -->`);
        SPLASH_SIZES.forEach((s) => {
            lines.push(
                `<link rel="apple-touch-startup-image" media="(device-width:${Math.round(s.w / 2)}px) and (device-height:${Math.round(s.h / 2)}px) and (-webkit-device-pixel-ratio:2)" href="${ip}splash-${s.w}x${s.h}.png">`
            );
        });
    }

    lines.push(
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- PWA / Theme Color                              -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<meta name="theme-color" content="${esc(themeColor)}">`,
        `<meta name="mobile-web-app-capable" content="yes">`,
        `<meta name="application-name" content="${esc(shortName)}">`,
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Favicon & Icons                                -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<link rel="shortcut icon" href="${esc(ip)}favicon.ico">`,
        `<link rel="icon" type="image/x-icon" href="${esc(ip)}favicon.ico">`,
        `<link rel="icon" type="image/png" sizes="16x16" href="${esc(ip)}icon-16.png">`,
        `<link rel="icon" type="image/png" sizes="32x32" href="${esc(ip)}icon-32.png">`,
        `<link rel="icon" type="image/png" sizes="64x64" href="${esc(ip)}icon-64.png">`,
        `<link rel="icon" type="image/png" sizes="128x128" href="${esc(ip)}icon-128.png">`,
        `<link rel="icon" type="image/png" sizes="192x192" href="${esc(ip)}icon-192.png">`,
        `<link rel="icon" type="image/png" sizes="512x512" href="${esc(ip)}icon-512.png">`,
        `<link rel="apple-touch-icon" href="${esc(ip)}icon-192.png">`,
        `<link rel="apple-touch-icon" sizes="180x180" href="${esc(ip)}icon-192.png">`,
        `<link rel="apple-touch-icon" sizes="512x512" href="${esc(ip)}icon-512.png">`,
        `<link rel="mask-icon" href="${esc(ip)}icon-512.png" color="${esc(themeColor)}">`,
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Manifest                                       -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<link rel="manifest" href="manifest.json">`,
        ``,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<!-- Service Worker + PWA Install Prompt            -->`,
        `<!-- (place before </body> or keep here)            -->`,
        `<!-- ══════════════════════════════════════════════ -->`,
        `<script>`,
        `if ('serviceWorker' in navigator) {`,
        `  window.addEventListener('load', () => {`,
        `    navigator.serviceWorker.register('/service-worker.js').then(reg => {`,
        `      console.log('[PWA] SW registered, scope:', reg.scope);`,
        `      reg.addEventListener('updatefound', () => {`,
        `        const nw = reg.installing;`,
        `        nw.addEventListener('statechange', () => {`,
        `          if (nw.state === 'installed' && navigator.serviceWorker.controller) {`,
        `            if (confirm('Nova versão disponível! Recarregar?')) {`,
        `              nw.postMessage({ type: 'SKIP_WAITING' });`,
        `              location.reload();`,
        `            }`,
        `          }`,
        `        });`,
        `      });`,
        `    }).catch(err => console.error('[PWA] SW failed:', err));`,
        `  });`,
        `}`,
        ``,
        `let _installPrompt = null;`,
        `window.addEventListener('beforeinstallprompt', e => {`,
        `  e.preventDefault(); _installPrompt = e;`,
        `  // Show your install button: document.getElementById('btn-install').hidden = false;`,
        `});`,
        `function installPWA() {`,
        `  if (!_installPrompt) return;`,
        `  _installPrompt.prompt();`,
        `  _installPrompt.userChoice.then(() => { _installPrompt = null; });`,
        `}`,
        `window.addEventListener('appinstalled', () => console.log('[PWA] App installed!'));`,
        `<\/script>`
    );
    return lines.join("\n");
}

// ════════════════════════════════════════════════════
// JSON-LD (dynamic by category)
// ════════════════════════════════════════════════════
const SCHEMA_TYPES = {
    games: "VideoGame",
    music: "MusicApplication",
    education: "EducationalApplication",
    finance: "FinanceApplication",
    health: "HealthApplication",
    medical: "MedicalWebPage",
    news: "NewsArticle",
    social: "SocialMediaPosting",
    shopping: "ShoppingCart",
    photo: "ImageObject",
    navigation: "Map",
    weather: "WeatherForecast",
    sports: "SportsEvent",
    food: "FoodEstablishment",
    travel: "TouristDestination",
};
function getSchemaType(cats) {
    for (const c of cats || []) {
        if (SCHEMA_TYPES[c]) return SCHEMA_TYPES[c];
    }
    return "WebApplication";
}

function buildJsonLd(manifest) {
    const name = manifest.name,
        desc = manifest.description || "";
    const url = manifest.start_url,
        author = v("appAuthor") || name;
    const version = v("appVersion") || "1.0",
        lang = manifest.lang || "en";
    const iconPfx = v("iconPath").replace(/\/$/, "") + "/";
    const ip = iconPfx === "/" ? "" : iconPfx;
    const base = url.replace(/\/$/, "");
    const cats = manifest.categories || [];
    const schemaType = getSchemaType(cats);

    const jsonld = {
        "@context": "https://schema.org",
        "@type": schemaType,
        name,
        description: desc,
        url,
        applicationCategory: cats[0] || "WebApplication",
        operatingSystem: "Any",
        softwareVersion: version,
        inLanguage: lang,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        screenshot: `${base}/${ip}social-preview-github.png`,
        browserRequirements: "Requires JavaScript. Requires HTML5.",
        featureList: ["Works offline (PWA)", "Installable", "Push notifications"],
        image: `${base}/${ip}icon-512.png`,
        author: { "@type": "Organization", name: author },
        maintainer: { "@type": "Organization", name: author },
        isAccessibleForFree: true,
        ...(version ? { softwareVersion: version } : {}),
    };
    return `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n<\/script>`;
}

// ════════════════════════════════════════════════════
// MAIN GENERATE
// ════════════════════════════════════════════════════
document.getElementById("generateBtn").addEventListener("click", generate);
document.getElementById("regenBtn").addEventListener("click", generate);

async function generate() {
    if (!validateUrl() && v("startUrl")) {
        showToast("URL inválida. Corrija antes de gerar.", "error");
        return;
    }
    if (!srcCanvas) {
        showToast("Upload uma imagem primeiro.", "error");
        return;
    }

    const btn = document.getElementById("generateBtn");
    btn.disabled = true;
    showProgress(true);
    setProgress(5, "Iniciando...");
    saveState();

    const manifest = buildManifest();
    const iconPfx = v("iconPath").replace(/\/$/, "") + "/";
    const ip = iconPfx === "/" ? "" : iconPfx;
    const zip = new JSZip();
    const iconGridEl = document.getElementById("iconGrid");
    iconGridEl.innerHTML = "";

    // ── Icons ──
    const iconSizes = [16, 32, 64, 128, 192, 256, 512];
    for (let i = 0; i < iconSizes.length; i++) {
        const s = iconSizes[i];
        const c = resizeCanvas(srcCanvas, s, s);
        zip.file(`${ip}icon-${s}.png`, await canvasToBuffer(c));
        setProgress(5 + i * 7, `Gerando icon-${s}.png...`);
        // preview
        const div = document.createElement("div");
        div.className = "icon-item";
        const pc = resizeCanvas(srcCanvas, Math.min(s, 64), Math.min(s, 64));
        pc.style.width = Math.min(s, 64) + "px";
        pc.style.height = Math.min(s, 64) + "px";
        div.appendChild(pc);
        const lbl = document.createElement("span");
        lbl.textContent = s + "px";
        div.appendChild(lbl);
        iconGridEl.appendChild(div);
    }
    setProgress(58, "Gerando ícone maskable...");

    // ── Maskable icon ──
    if (document.getElementById("genMaskable").checked) {
        const mc = buildMaskableCanvas(srcCanvas, 512);
        zip.file(`${ip}icon-maskable-512.png`, await canvasToBuffer(mc));
        const div = document.createElement("div");
        div.className = "icon-item";
        const pc = buildMaskableCanvas(srcCanvas, 64);
        pc.style.width = "64px";
        pc.style.height = "64px";
        div.appendChild(pc);
        const lbl = document.createElement("span");
        lbl.textContent = "maskable";
        div.appendChild(lbl);
        iconGridEl.appendChild(div);
    }

    setProgress(62, "Gerando favicon.ico...");
    zip.file(`${ip}favicon.ico`, await buildIco(srcCanvas));

    setProgress(66, "Gerando social preview...");
    const social = buildSocialPreview(srcCanvas);
    zip.file(`${ip}social-preview-github.png`, await canvasToBuffer(social));

    // ── Apple splash screens ──
    let splashCount = 0;
    if (document.getElementById("genSplash").checked) {
        setProgress(70, "Gerando Apple splash screens...");
        for (const sp of SPLASH_SIZES) {
            const c = buildSplash(srcCanvas, sp.w, sp.h);
            zip.file(`${ip}splash-${sp.w}x${sp.h}.png`, await canvasToBuffer(c));
            splashCount++;
        }
    }

    setProgress(78, "Gerando manifest.json...");
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    setProgress(81, "Gerando service-worker.js...");
    const swContent = buildServiceWorker(manifest);
    zip.file("service-worker.js", swContent);

    setProgress(83, "Gerando offline.html...");
    const offlineHtml = buildOfflineHtml(manifest);
    zip.file("offline.html", offlineHtml);

    setProgress(85, "Gerando browserconfig.xml...");
    zip.file("browserconfig.xml", buildBrowserConfig(manifest, ip));

    setProgress(87, "Gerando robots.txt & sitemap.xml...");
    const robotsTxt = buildRobotsTxt(manifest.start_url);
    const sitemapXml = buildSitemapXml(manifest.start_url);
    zip.file("robots.txt", robotsTxt);
    zip.file("sitemap.xml", sitemapXml);

    setProgress(89, "Gerando humans.txt...");
    zip.file("humans.txt", buildHumansTxt(manifest));

    setProgress(92, "Comprimindo ZIP...");
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const zipUrl = URL.createObjectURL(zipBlob);
    const dl = document.getElementById("downloadZip");
    dl.href = zipUrl;
    dl.download = "pwa-package.zip";

    // File list summary
    let fileCount = iconSizes.length + 5; // icons + favicon + social + manifest + sw + offline
    if (document.getElementById("genMaskable").checked) fileCount++;
    fileCount += 3; // browserconfig, robots, sitemap, humans
    if (document.getElementById("genSplash").checked) fileCount += splashCount;
    const zipKb = (zipBlob.size / 1024).toFixed(0);
    document.getElementById("zipContents").textContent = `${fileCount} arquivos · ${zipKb} KB`;

    setProgress(96, "Gerando snippets de código...");
    const headCode = buildHeadCode(manifest);
    const jsonldCode = buildJsonLd(manifest);

    document.getElementById("headCode").textContent = headCode;
    document.getElementById("headCode").innerHTML = syntaxHL(headCode, "html");

    document.getElementById("manifestCode").innerHTML = syntaxHL(JSON.stringify(manifest, null, 2), "json");

    const swPre = document.getElementById("swCode");
    swPre.dataset.raw = swContent;
    swPre.textContent = swContent;

    document.getElementById("jsonldCode").textContent = jsonldCode;
    document.getElementById("jsonldCode").innerHTML = syntaxHL(jsonldCode, "html");

    const offlinePre = document.getElementById("offlineCode");
    offlinePre.dataset.raw = offlineHtml;
    offlinePre.textContent = offlineHtml;

    const robotsPre = document.getElementById("robotsCode");
    robotsPre.dataset.raw = robotsTxt;
    robotsPre.textContent = robotsTxt;

    const sitemapPre = document.getElementById("sitemapCode");
    sitemapPre.dataset.raw = sitemapXml;
    sitemapPre.textContent = sitemapXml;

    setProgress(100, "Pronto! ✅");
    setTimeout(() => {
        showProgress(false);
        document.getElementById("outputSection").style.display = "block";
        document.getElementById("outputSection").scrollIntoView({ behavior: "smooth" });
        document.getElementById("stickyRegen").classList.add("show");
        btn.disabled = false;
        showToast("PWA package gerado com sucesso! 🎉", "success");
    }, 500);
}

function showProgress(v) {
    document.getElementById("progressWrap").style.display = v ? "block" : "none";
}
function setProgress(pct, text) {
    document.getElementById("progressFill").style.width = pct + "%";
    document.getElementById("progressText").textContent = text;
}

// ════════════════════════════════════════════════════
// SYNTAX HIGHLIGHT
// ════════════════════════════════════════════════════
function syntaxHL(code, lang) {
    if (lang === "json") {
        return esc(code)
            .replace(
                /(&quot;(?:[^&]|&amp;|&lt;|&gt;)*?&quot;)(\s*:)/g,
                (m, k, c) => `<span class="s-key">${k}</span>${c}`
            )
            .replace(/:\s*(&quot;(?:[^&]|&amp;|&lt;|&gt;)*?&quot;)/g, (m, v) => `: <span class="s-str">${v}</span>`)
            .replace(/:\s*(-?\d+\.?\d*)/g, (m, n) => `: <span class="s-num">${n}</span>`)
            .replace(/:\s*(true|false|null)/g, (m, b) => `: <span class="s-bool">${b}</span>`);
    }
    // html
    return esc(code)
        .replace(/&lt;!--[\s\S]*?--&gt;/g, (m) => `<span class="s-cmt">${m}</span>`)
        .replace(/&lt;(\/?[\w:-]+)/g, (m, t) => `&lt;<span class="s-tag">${t}</span>`)
        .replace(/([\w-:]+)=&quot;/g, (m, a) => `<span class="s-attr">${a}</span>=&quot;`)
        .replace(/=&quot;([^&]*)&quot;/g, (m, v) => `=&quot;<span class="s-val">${v}</span>&quot;`);
}

// ════════════════════════════════════════════════════
// COPY
// ════════════════════════════════════════════════════
async function copyCode(id) {
    const el = document.getElementById(id);
    const text = el.dataset.raw || el.textContent;
    try {
        await navigator.clipboard.writeText(text);
        const btns = document.querySelectorAll(".btn-copy");
        btns.forEach((b) => {
            if (b.getAttribute("onclick").includes(id)) {
                b.textContent = "copied!";
                setTimeout(() => (b.textContent = "copy"), 1800);
            }
        });
        showToast("Copiado!", "success");
    } catch {
        showToast("Falha ao copiar.", "error");
    }
}

// ════════════════════════════════════════════════════
// TABS
// ════════════════════════════════════════════════════
document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active");
    });
});

// ════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════
function showToast(msg, type = "success") {
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = (type === "success" ? "✓ " : " ⚠ ") + msg;
    document.getElementById("toastContainer").appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════
function v(id) {
    return document.getElementById(id)?.value?.trim() || "";
}
function esc(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════
restoreState();
updateLivePreview();

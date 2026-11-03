// Detects the visitor's OS and points download buttons at the latest GitHub release.
// Every link already falls back to the releases page, so the page works without JS.
(async () => {
  const REPO = "andrewchuev/rmail";
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  const os = /Win/i.test(platform) || /Windows/.test(ua) ? "windows"
    : /Mac/i.test(platform) ? "mac"
    : /Linux|X11/.test(ua) && !/Android/.test(ua) ? "linux" : "other";
  document.documentElement.dataset.os = os;

  const names = { windows: "Windows", mac: "macOS", linux: "Linux" };
  document.querySelectorAll("[data-os-name]").forEach((el) => (el.textContent = names[os] || "your system"));

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) return;
    const rel = await res.json();
    const pick = (re) => rel.assets.find((a) => re.test(a.name));
    const assets = {
      windows: pick(/x64-setup\.exe$/),
      portable: pick(/windows-x64-portable\.zip$/),
      mac: pick(/\.dmg$/),
      appimage: pick(/\.AppImage$/),
      deb: pick(/\.deb$/),
      rpm: pick(/\.rpm$/),
    };
    const primary = { windows: assets.windows, mac: assets.mac, linux: assets.appimage }[os] || assets.windows;
    const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

    document.querySelectorAll("[data-version]").forEach((el) => (el.textContent = rel.tag_name));
    document.querySelectorAll('[data-dl="primary"]').forEach((a) => primary && (a.href = primary.browser_download_url));
    document.querySelectorAll("[data-dl]").forEach((a) => {
      const asset = assets[a.dataset.dl];
      if (asset) a.href = asset.browser_download_url;
    });
    document.querySelectorAll("[data-size]").forEach((el) => {
      const asset = assets[el.dataset.size] || (el.dataset.size === "primary" && primary);
      if (asset) el.textContent = mb(asset.size);
    });
  } catch {
    // Offline or rate-limited: keep the static fallback links.
  }
})();

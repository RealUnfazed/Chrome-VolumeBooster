# 🔊 Volume Booster

A lightweight Chrome extension that boosts the audio volume of the current browser tab up to **600%**.

Volume Booster uses Chrome's `tabCapture` API and the Web Audio API to capture, process, amplify, and output tab audio in real time.

## ✨ Features

- 🔊 Boost tab volume up to **600%**
- 🎚️ Adjustable boost level from **100% to 600%**
- 🛡️ Optional audio limiter to reduce distortion and clipping
- 💾 Remembers settings for individual tabs
- ⚡ Real-time volume adjustment
- 🪶 Lightweight Manifest V3 extension
- 🎧 Works with audio played directly inside the browser tab
- 🌐 No external servers or accounts required

## 📸 How It Works

The extension captures the current tab's audio and processes it through a Web Audio API pipeline:

```text
Browser Tab Audio
       │
       ▼
   tabCapture
       │
       ▼
   MediaStream
       │
       ▼
    GainNode
       │
       ▼
 Limiter / Compressor
       │
       ▼
    Speakers
```

The gain can be increased from:

```text
100% ─────────────────────────────── 600%
```

## 🚀 Installation

### Chrome

1. Download or clone this repository.

```bash
git clone https://github.com/RealUnfazed/Chrome-VolumeBooster.git
```

2. Open Chrome and navigate to:

```text
chrome://extensions
```

3. Enable **Developer mode**.

4. Click **Load unpacked**.

5. Select the project directory.

6. Pin **Volume Booster** to your browser toolbar.

7. Open a tab that is playing audio.

8. Click the Volume Booster icon.

9. Enable **Volume Boost**.

10. Adjust the boost level as needed.

## 🎛️ Controls

### Volume Boost

Turns audio amplification on or off for the current tab.

### Boost Level

Controls the amplification level.

```text
100% = Original volume
200% = 2× gain
300% = 3× gain
400% = 4× gain
500% = 5× gain
600% = 6× gain
```

### Limiter

The limiter uses dynamic compression to reduce excessive peaks when using high amplification levels.

It is recommended to keep the limiter enabled when using high boost levels.

## 🧩 Project Structure

```text
volume-booster/
│
├── manifest.json
├── background.js
│
├── audio/
│   ├── offscreen.html
│   └── offscreen.js
│
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
│
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
│
├── LICENSE
└── README.md
```

## 🔐 Permissions

The extension uses the following Chrome permissions:

- `tabCapture` — captures audio from the active browser tab.
- `offscreen` — provides an offscreen document for audio processing.
- `storage` — stores per-tab Volume Booster settings.

The extension does not require an external server, user account, or cloud service.

## ⚠️ Limitations

Chrome does not allow normal tab capture on certain browser-owned pages, such as Chrome's internal pages and the Chrome Web Store.

The extension is currently focused on Chromium-based browsers with support for the required Manifest V3 APIs.

## 🛠️ Technologies

- JavaScript
- HTML
- CSS
- Chrome Extensions Manifest V3
- Chrome `tabCapture` API
- Web Audio API
- `AudioContext`
- `GainNode`
- `DynamicsCompressorNode`

## 👨‍💻 Author

Created and maintained by **Alireza Asakareh (RealUnfazed)**.

GitHub:
https://github.com/realunfazed

## 📄 License

This project is licensed under the **MIT License**.

See the [LICENSE](LICENSE) file for the complete license text.

## ⭐ Support

If you find Volume Booster useful, consider giving the repository a ⭐ on GitHub.

Made with ❤️ and 🎵 by **RealUnfazed**.

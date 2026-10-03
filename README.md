# Campus Share ⚡
> **"Share files even when the network isn't cooperating."**

Campus Share is a lightweight, beginner-friendly web application designed for college students to share files (images, PDFs, text, and documents) directly between nearby devices over a common local network (College Wi-Fi, Personal Wi-Fi, Mobile Hotspot) with minimum dependence on external internet connectivity.

---

## 📁 Project Structure

```text
campus-share/
├── app.py                  # Flask backend server & REST API
├── requirements.txt        # Python package dependencies
├── README.md               # Documentation & setup guide
│
├── templates/
│   ├── base.html           # Core layout header/footer with local IP badge
│   ├── index.html          # Landing home page with Send/Receive options
│   ├── send.html           # Sender interface with file drag-and-drop & QR code
│   └── receive.html        # Receiver interface with 6-digit code entry & download
│
├── static/
│   ├── css/
│   │   └── style.css       # Clean, modern, student-friendly styling
│   └── js/
│       ├── send.js         # Chunked upload, QR code rendering & status polling
│       └── receive.js      # Resumable chunked download & client file assembly
│
└── uploads/                # Temporary directory for session chunks (auto-cleaned)
```

---

## 🚀 Quick Setup & Installation

### 1. Requirements
- Python 3.8 or higher installed on your computer.
- All devices (Sender & Receiver) connected to the **same local network** (College Wi-Fi, Personal Wi-Fi, or Mobile Hotspot).

### 2. Install Dependencies
Open your terminal in the `campus-share` folder and run:
```bash
pip install -r requirements.txt
```

### 3. Launch the Server
```bash
python app.py
```

When started, the terminal will display your local network address, for example:
```text
============================================================
  CAMPUS SHARE - Local Network File Sharing Prototype
============================================================
  Local IP Address : http://192.168.1.15:5000
  Access from nearby devices on the same Wi-Fi / Hotspot!
============================================================
```

---

## 📱 How to Test Using Two Devices

### Device A (Sender - e.g. Laptop / Desktop):
1. Open your browser and go to `http://localhost:5000` or `http://<YOUR_LOCAL_IP>:5000`.
2. Click **Send File**.
3. Choose or drop a file (PDF, Image, TXT, up to 50 MB).
4. Click **Create Share**.
5. A **6-Digit Share Code** (e.g. `482913`) and a **QR Code** will be generated on screen.

### Device B (Receiver - e.g. Smartphone / Second Laptop):
1. Make sure Device B is connected to the same Wi-Fi or Mobile Hotspot as Device A.
2. Option A: Scan the QR code displayed on Device A using your smartphone camera.
3. Option B: Open browser on Device B, go to `http://<LOCAL_IP>:5000/receive`, enter the 6-digit code, and tap **Connect**.
4. The transfer will begin automatically with real-time progress.
5. Tap **Download File** to save the file locally!

---

## 🛠️ Development Phases & Roadmap

### Phase 1: Core Foundation & UI ✅
- Simple, modern, responsive UI built with vanilla HTML5, CSS3, and JavaScript.
- Flask backend serving home, send, and receive routes.
- Basic file validation (limiting to 50 MB max).

### Phase 2: Session Management & QR Codes ✅
- Unique temporary 6-digit session codes generated on demand.
- Dynamic QR code generation for quick mobile device pairing via camera scan.
- Real-time polling updates for session states (*Waiting for receiver*, *Connected*, *Transferring*, *Completed*).

### Phase 3: Chunked Transfer & Automatic Expiration ✅
- Files split into 1 MB chunks during transfer to maintain reliability on weak Wi-Fi networks.
- Automatic background cleanup thread that deletes expired sessions and temporary files after 30 minutes.

### Phase 4: Resumable Interrupted Transfers ✅
- Receiver tracks downloaded chunk indices.
- If network drops mid-transfer, a **"Resume Transfer"** prompt allows resuming from the last completed chunk without restarting from 0%.

### Phase 5: Future Network Independence & WebRTC P2P Roadmap 🔮
- Current prototype uses the local Flask server on LAN as a zero-internet local bridge.
- Future versions will implement WebRTC DataChannel signaling over WebSockets for direct peer-to-peer browser data streaming without intermediate disk storage.

---

## ⚠️ Limitations & Honest Disclaimer
- **Same Network Required**: Currently requires both devices to be connected to the same Wi-Fi router, LAN, or Mobile Hotspot.
- **Browser Limits**: Browser memory limits large file Blob assembly on lower-end mobile devices (kept at 50 MB limit for stability).

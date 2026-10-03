import os
import io
import time
import random
import socket
import threading
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for
from werkzeug.utils import secure_filename
import qrcode

app = Flask(__name__)

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE = 1 * 1024 * 1024       # 1 MB chunk size for resumable transfers
SESSION_EXPIRY_MINUTES = 30       # Expire inactive sessions after 30 minutes

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE + (5 * 1024 * 1024) # Include headers margin

# Ensure uploads directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory storage for active file sharing sessions
# Structure: { session_code: { metadata... } }
sessions = {}
sessions_lock = threading.Lock()

# Helper: Get primary local network IP address
def get_local_ip():
    """Finds the local network IP address of this machine (Wi-Fi / LAN / Hotspot)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Does not actually connect to 8.8.8.8, but opens socket route to determine local IP
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

# Helper: Generate random 6-digit numeric code
def generate_6digit_code():
    """Generates a unique 6-digit session code."""
    with sessions_lock:
        while True:
            code = f"{random.randint(100000, 999999)}"
            if code not in sessions:
                return code

# Helper: Clean up expired sessions and temporary files
def cleanup_expired_sessions():
    """Deletes temporary files and session data older than SESSION_EXPIRY_MINUTES."""
    now = datetime.now()
    with sessions_lock:
        expired_codes = []
        for code, data in sessions.items():
            created_at = data.get('created_at')
            if created_at and (now - created_at) > timedelta(minutes=SESSION_EXPIRY_MINUTES):
                expired_codes.append(code)
        
        for code in expired_codes:
            session_dir = os.path.join(UPLOAD_FOLDER, code)
            if os.path.exists(session_dir):
                try:
                    for fname in os.listdir(session_dir):
                        os.remove(os.path.join(session_dir, fname))
                    os.rmdir(session_dir)
                except Exception as e:
                    print(f"[Cleanup Error] Failed to delete directory {session_dir}: {e}")
            del sessions[code]
            print(f"[Cleanup] Expired session {code} removed.")

# Background thread for periodic session cleanup
def start_cleanup_timer():
    cleanup_expired_sessions()
    threading.Timer(300, start_cleanup_timer).start() # Run every 5 minutes

start_cleanup_timer()

# ---------------------------------------------------------------------------
# ROUTES: Pages
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html', local_ip=get_local_ip())

@app.route('/send')
def send_page():
    return render_template('send.html', local_ip=get_local_ip())

@app.route('/receive')
def receive_page():
    code_arg = request.args.get('code', '')
    return render_template('receive.html', default_code=code_arg, local_ip=get_local_ip())

# ---------------------------------------------------------------------------
# API ENDPOINTS
# ---------------------------------------------------------------------------

@app.route('/api/network-info', methods=['GET'])
def network_info():
    """Returns the local server IP address and port."""
    host_header = request.host
    port = host_header.split(':')[1] if ':' in host_header else '5000'
    local_ip = get_local_ip()
    return jsonify({
        'local_ip': local_ip,
        'port': port,
        'base_url': f"http://{local_ip}:{port}"
    })

@app.route('/api/create-session', methods=['POST'])
def create_session():
    """
    Step 1 for Sender: Registers a new file sharing session.
    Receives JSON with file metadata: filename, filesize, total_chunks.
    """
    data = request.get_json() or {}
    filename = data.get('filename')
    filesize = data.get('filesize', 0)
    total_chunks = data.get('total_chunks', 1)

    if not filename or filesize <= 0:
        return jsonify({'error': 'Invalid file metadata.'}), 400

    if filesize > MAX_FILE_SIZE:
        return jsonify({'error': f'File exceeds maximum allowed size of {MAX_FILE_SIZE // (1024*1024)} MB.'}), 400

    code = generate_6digit_code()
    safe_name = secure_filename(filename) or "shared_file"
    
    # Create directory for session chunks/file
    session_dir = os.path.join(UPLOAD_FOLDER, code)
    os.makedirs(session_dir, exist_ok=True)

    with sessions_lock:
        sessions[code] = {
            'code': code,
            'original_filename': filename,
            'safe_filename': safe_name,
            'filesize': filesize,
            'total_chunks': total_chunks,
            'chunk_size': CHUNK_SIZE,
            'uploaded_chunks': {},
            'status': 'waiting',  # waiting, uploading, connected, transferring, completed
            'receiver_connected': False,
            'created_at': datetime.now(),
            'last_active': datetime.now()
        }

    return jsonify({
        'success': True,
        'code': code,
        'message': 'Session created successfully.',
        'chunk_size': CHUNK_SIZE
    })

@app.route('/api/upload-chunk', methods=['POST'])
def upload_chunk():
    """
    Step 2 for Sender: Uploads individual file chunks to server.
    Allows resumable chunked upload.
    """
    code = request.form.get('code')
    chunk_index = request.form.get('chunk_index', type=int)
    total_chunks = request.form.get('total_chunks', type=int)
    file_chunk = request.files.get('file')

    if not code or code not in sessions:
        return jsonify({'error': 'Invalid or expired session code.'}), 404

    if file_chunk is None or chunk_index is None:
        return jsonify({'error': 'Missing chunk data or index.'}), 400

    session = sessions[code]
    session_dir = os.path.join(UPLOAD_FOLDER, code)
    chunk_filename = f"chunk_{chunk_index}.dat"
    chunk_path = os.path.join(session_dir, chunk_filename)

    file_chunk.save(chunk_path)
    session['uploaded_chunks'][chunk_index] = os.path.getsize(chunk_path)
    session['last_active'] = datetime.now()

    # Update status if all chunks uploaded
    if len(session['uploaded_chunks']) >= total_chunks:
        session['status'] = 'ready'

    return jsonify({
        'success': True,
        'chunk_index': chunk_index,
        'uploaded_chunks': len(session['uploaded_chunks']),
        'total_chunks': total_chunks
    })

@app.route('/api/session-status/<code>', methods=['GET'])
def session_status(code):
    """
    Returns real-time status of a session.
    Used by both sender and receiver to monitor state.
    """
    with sessions_lock:
        if code not in sessions:
            return jsonify({'status': 'expired', 'error': 'Session not found or expired.'}), 404

        session = sessions[code]
        session['last_active'] = datetime.now()
        
        return jsonify({
            'code': session['code'],
            'filename': session['original_filename'],
            'filesize': session['filesize'],
            'total_chunks': session['total_chunks'],
            'uploaded_chunks': len(session['uploaded_chunks']),
            'status': session['status'],
            'receiver_connected': session['receiver_connected']
        })

@app.route('/api/connect-session', methods=['POST'])
def connect_session():
    """
    Step 1 for Receiver: Enter 6-digit code to connect to sender's session.
    """
    data = request.get_json() or {}
    code = str(data.get('code', '')).strip()

    with sessions_lock:
        if code not in sessions:
            return jsonify({'error': 'Invalid 6-digit code or session has expired.'}), 404

        session = sessions[code]
        session['receiver_connected'] = True
        if session['status'] == 'waiting' or session['status'] == 'ready':
            session['status'] = 'connected'
        session['last_active'] = datetime.now()

        return jsonify({
            'success': True,
            'code': session['code'],
            'filename': session['original_filename'],
            'filesize': session['filesize'],
            'total_chunks': session['total_chunks'],
            'chunk_size': session['chunk_size'],
            'uploaded_chunks': len(session['uploaded_chunks'])
        })

@app.route('/api/download-chunk/<code>/<int:chunk_index>', methods=['GET'])
def download_chunk(code, chunk_index):
    """
    Step 2 for Receiver: Downloads a specific chunk.
    Enables resumable chunked file transfers!
    """
    if code not in sessions:
        return jsonify({'error': 'Invalid session.'}), 404

    session = sessions[code]
    session_dir = os.path.join(UPLOAD_FOLDER, code)
    chunk_path = os.path.join(session_dir, f"chunk_{chunk_index}.dat")

    if not os.path.exists(chunk_path):
        return jsonify({'error': f'Chunk {chunk_index} not ready or found.'}), 404

    session['status'] = 'transferring'
    session['last_active'] = datetime.now()

    return send_file(
        chunk_path,
        mimetype='application/octet-stream',
        as_attachment=True,
        download_name=f"chunk_{chunk_index}.dat"
    )

@app.route('/api/complete-transfer', methods=['POST'])
def complete_transfer():
    """
    Called when receiver finishes downloading all chunks.
    Marks session as completed.
    """
    data = request.get_json() or {}
    code = data.get('code')

    if code in sessions:
        sessions[code]['status'] = 'completed'
        sessions[code]['last_active'] = datetime.now()
        return jsonify({'success': True, 'message': 'Transfer completed!'})
    
    return jsonify({'error': 'Session not found.'}), 404

@app.route('/api/qr-code/<code>', methods=['GET'])
def get_qr_code(code):
    """
    Generates a QR code image containing the direct Receive URL for a session.
    """
    local_ip = get_local_ip()
    host_header = request.host
    port = host_header.split(':')[1] if ':' in host_header else '5000'
    receive_url = f"http://{local_ip}:{port}/receive?code={code}"

    # Generate QR Code
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(receive_url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="#1e293b", back_color="#ffffff")
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    buf.seek(0)

    return send_file(buf, mimetype='image/png')

if __name__ == '__main__':
    local_ip = get_local_ip()
    print("=" * 60)
    print("  CAMPUS SHARE - Local Network File Sharing Prototype")
    print("=" * 60)
    print(f"  Local IP Address : http://{local_ip}:5000")
    print("  Access from nearby devices on the same Wi-Fi / Hotspot!")
    print("=" * 60)
    
    # Run server on all network interfaces (0.0.0.0) so nearby devices can access it
    app.run(host='0.0.0.0', port=5000, debug=True)

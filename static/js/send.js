/**
 * Campus Share - Send Page Client Script
 * Handles file selection, chunked upload, session management & status polling.
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Element references
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const filePreview = document.getElementById('filePreview');
    const fileNameEl = document.getElementById('fileName');
    const fileSizeEl = document.getElementById('fileSize');
    const fileTypeIconEl = document.getElementById('fileTypeIcon');
    const removeFileBtn = document.getElementById('removeFileBtn');
    const createShareBtn = document.getElementById('createShareBtn');

    const selectionStep = document.getElementById('selectionStep');
    const shareStep = document.getElementById('shareStep');
    const codeDisplay = document.getElementById('codeDisplay');
    const qrCodeImg = document.getElementById('qrCodeImg');
    const qrLoading = document.getElementById('qrLoading');
    const cancelShareBtn = document.getElementById('cancelShareBtn');

    const statusDot = document.getElementById('statusDot');
    const statusTitle = document.getElementById('statusTitle');
    const statusDesc = document.getElementById('statusDesc');

    const progressSection = document.getElementById('progressSection');
    const progressBarFill = document.getElementById('progressBarFill');
    const progressPercent = document.getElementById('progressPercent');

    // Constants
    const MAX_SIZE_MB = 50;
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunk size

    // State
    let selectedFile = null;
    let currentSessionCode = null;
    let pollInterval = null;
    let isUploading = false;

    // -------------------------------------------------------------------
    // File Selection & Drag-and-Drop Handlers
    // -------------------------------------------------------------------
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    removeFileBtn.addEventListener('click', resetFileSelection);

    function handleFileSelect(file) {
        // Validate File Size (Max 50MB)
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
            showToast(`File size exceeds limit of ${MAX_SIZE_MB} MB.`, 'error');
            return;
        }

        selectedFile = file;
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = formatBytes(file.size);
        fileTypeIconEl.textContent = getFileIcon(file.name);

        filePreview.classList.remove('hidden');
    }

    function resetFileSelection() {
        selectedFile = null;
        fileInput.value = '';
        filePreview.classList.add('hidden');
    }

    // -------------------------------------------------------------------
    // Create Share Session
    // -------------------------------------------------------------------
    createShareBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        createShareBtn.disabled = true;
        createShareBtn.textContent = 'Creating Session...';

        const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);

        try {
            const res = await fetch('/api/create-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: selectedFile.name,
                    filesize: selectedFile.size,
                    total_chunks: totalChunks
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                showToast(data.error || 'Failed to create share session.', 'error');
                createShareBtn.disabled = false;
                createShareBtn.textContent = 'Create Share';
                return;
            }

            currentSessionCode = data.code;
            codeDisplay.textContent = currentSessionCode;

            // Transition UI to Share Step
            selectionStep.classList.add('hidden');
            shareStep.classList.remove('hidden');

            // Load QR Code
            qrCodeImg.src = `/api/qr-code/${currentSessionCode}`;
            qrCodeImg.onload = () => {
                qrLoading.classList.add('hidden');
                qrCodeImg.classList.remove('hidden');
            };

            // Start uploading file chunks to server
            uploadFileChunks(currentSessionCode, selectedFile, totalChunks);

            // Start polling receiver status
            startStatusPolling(currentSessionCode);

        } catch (err) {
            console.error(err);
            showToast('Network error while creating share.', 'error');
            createShareBtn.disabled = false;
            createShareBtn.textContent = 'Create Share';
        }
    });

    // -------------------------------------------------------------------
    // Chunked Upload Logic
    // -------------------------------------------------------------------
    async function uploadFileChunks(code, file, totalChunks) {
        isUploading = true;
        progressSection.classList.remove('hidden');
        
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            if (!isUploading) break;

            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunkBlob = file.slice(start, end);

            const formData = new FormData();
            formData.append('code', code);
            formData.append('chunk_index', chunkIndex);
            formData.append('total_chunks', totalChunks);
            formData.append('file', chunkBlob, `chunk_${chunkIndex}.dat`);

            try {
                const res = await fetch('/api/upload-chunk', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                
                if (!res.ok) {
                    showToast(`Failed uploading chunk ${chunkIndex + 1}`, 'error');
                    break;
                }

                // Update Upload Progress
                const percent = Math.round(((chunkIndex + 1) / totalChunks) * 100);
                progressBarFill.style.width = `${percent}%`;
                progressPercent.textContent = `${percent}%`;

            } catch (err) {
                console.error('Upload chunk error:', err);
                showToast('Chunk upload interrupted. Retrying...', 'info');
                chunkIndex--; // Retry chunk
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    // -------------------------------------------------------------------
    // Status Polling
    // -------------------------------------------------------------------
    function startStatusPolling(code) {
        pollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/session-status/${code}`);
                if (!res.ok) return;

                const data = await res.json();
                
                if (data.status === 'expired') {
                    clearInterval(pollInterval);
                    showToast('Session expired.', 'error');
                    return;
                }

                // Update UI based on status
                if (data.receiver_connected || data.status === 'connected' || data.status === 'transferring') {
                    statusDot.className = 'status-indicator-dot connected';
                    statusTitle.textContent = 'Receiver connected!';
                    statusDesc.textContent = 'Transferring file to receiver...';
                }

                if (data.status === 'completed') {
                    statusDot.className = 'status-indicator-dot completed';
                    statusTitle.textContent = 'Transfer Completed!';
                    statusDesc.textContent = 'Receiver successfully downloaded the file.';
                    clearInterval(pollInterval);
                }

            } catch (err) {
                console.error('Status poll error:', err);
            }
        }, 1500);
    }

    // -------------------------------------------------------------------
    // Cancel Share
    // -------------------------------------------------------------------
    cancelShareBtn.addEventListener('click', () => {
        isUploading = false;
        if (pollInterval) clearInterval(pollInterval);
        
        // Reset UI
        shareStep.classList.add('hidden');
        selectionStep.classList.remove('hidden');
        resetFileSelection();
        createShareBtn.disabled = false;
        createShareBtn.textContent = 'Create Share';
        showToast('Share session cancelled.', 'info');
    });

    // -------------------------------------------------------------------
    // Utility Helpers
    // -------------------------------------------------------------------
    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️';
        if (['pdf'].includes(ext)) return '📄';
        if (['txt', 'md', 'csv'].includes(ext)) return '📝';
        if (['zip', 'rar', '7z'].includes(ext)) return '📦';
        return '📁';
    }
});

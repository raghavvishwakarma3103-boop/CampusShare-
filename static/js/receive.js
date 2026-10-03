/**
 * Campus Share - Receive Page Client Script
 * Connects to sender's session using 6-digit code, downloads file chunks,
 * supports resumable transfers, and triggers client-side file save.
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Element references
    const connectForm = document.getElementById('connectForm');
    const codeInput = document.getElementById('codeInput');
    const connectBtn = document.getElementById('connectBtn');

    const connectStep = document.getElementById('connectStep');
    const transferStep = document.getElementById('transferStep');

    const recvStatusDot = document.getElementById('recvStatusDot');
    const recvStatusTitle = document.getElementById('recvStatusTitle');
    const recvStatusDesc = document.getElementById('recvStatusDesc');

    const recvFileTypeIcon = document.getElementById('recvFileTypeIcon');
    const recvFileName = document.getElementById('recvFileName');
    const recvFileSize = document.getElementById('recvFileSize');

    const recvProgressBarFill = document.getElementById('recvProgressBarFill');
    const recvProgressPercent = document.getElementById('recvProgressPercent');
    const recvProgressLabel = document.getElementById('recvProgressLabel');
    const transferStats = document.getElementById('transferStats');

    const resumeCard = document.getElementById('resumeCard');
    const resumeBtn = document.getElementById('resumeBtn');
    const downloadFileBtn = document.getElementById('downloadFileBtn');

    // Transfer State Variables
    let sessionCode = '';
    let metadata = null;
    let downloadedChunks = [];
    let currentChunkIndex = 0;
    let isTransferring = false;
    let assembledFileUrl = null;

    // Auto-connect if code is present in URL
    if (codeInput.value.length === 6) {
        initiateConnection(codeInput.value.trim());
    }

    // Connect Form Submit
    connectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = codeInput.value.trim();
        if (code.length !== 6 || isNaN(code)) {
            showToast('Please enter a valid 6-digit numeric code.', 'error');
            return;
        }
        initiateConnection(code);
    });

    // -------------------------------------------------------------------
    // Connect to Session
    // -------------------------------------------------------------------
    async function initiateConnection(code) {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';

        try {
            const res = await fetch('/api/connect-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                showToast(data.error || 'Failed to connect. Invalid or expired code.', 'error');
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect';
                return;
            }

            // Connection Successful
            sessionCode = code;
            metadata = data;
            downloadedChunks = new Array(metadata.total_chunks);

            // Display File Metadata
            recvFileName.textContent = metadata.filename;
            recvFileSize.textContent = formatBytes(metadata.filesize);
            recvFileTypeIcon.textContent = getFileIcon(metadata.filename);

            // Transition UI
            connectStep.classList.add('hidden');
            transferStep.classList.remove('hidden');

            showToast('Connected to sender!', 'success');

            // Start Chunked Download
            startChunkedDownload();

        } catch (err) {
            console.error(err);
            showToast('Network error while connecting.', 'error');
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect';
        }
    }

    // -------------------------------------------------------------------
    // Chunked Download & Resumable Transfer
    // -------------------------------------------------------------------
    async function startChunkedDownload() {
        isTransferring = true;
        resumeCard.classList.add('hidden');
        recvStatusTitle.textContent = 'Transferring file...';
        recvStatusDesc.textContent = 'Downloading file chunks directly from local server.';

        while (currentChunkIndex < metadata.total_chunks && isTransferring) {
            try {
                const res = await fetch(`/api/download-chunk/${sessionCode}/${currentChunkIndex}`);
                if (!res.ok) {
                    throw new Error(`Chunk ${currentChunkIndex} not ready or server error.`);
                }

                const chunkBlob = await res.blob();
                downloadedChunks[currentChunkIndex] = chunkBlob;

                currentChunkIndex++;

                // Update Progress UI
                const percent = Math.round((currentChunkIndex / metadata.total_chunks) * 100);
                recvProgressBarFill.style.width = `${percent}%`;
                recvProgressPercent.textContent = `${percent}%`;

                const downloadedBytes = Math.min(currentChunkIndex * metadata.chunk_size, metadata.filesize);
                transferStats.textContent = `${formatBytes(downloadedBytes)} of ${formatBytes(metadata.filesize)}`;

            } catch (err) {
                console.error(`Error fetching chunk ${currentChunkIndex}:`, err);
                isTransferring = false;
                
                // Show Resumable Transfer UI
                recvStatusDot.className = 'status-indicator-dot waiting';
                recvStatusTitle.textContent = 'Transfer Paused / Interrupted';
                recvStatusDesc.textContent = 'Network connection dropped during transfer.';
                resumeCard.classList.remove('hidden');
                return;
            }
        }

        // All Chunks Downloaded Successfully
        if (currentChunkIndex >= metadata.total_chunks) {
            finishTransfer();
        }
    }

    // Resume Button Handler
    resumeBtn.addEventListener('click', () => {
        showToast(`Resuming transfer from chunk ${currentChunkIndex + 1}...`, 'info');
        recvStatusDot.className = 'status-indicator-dot connected';
        startChunkedDownload();
    });

    // -------------------------------------------------------------------
    // Reassemble File & Trigger Download
    // -------------------------------------------------------------------
    async function finishTransfer() {
        recvStatusDot.className = 'status-indicator-dot completed';
        recvStatusTitle.textContent = 'Transfer Completed!';
        recvStatusDesc.textContent = 'File is ready for download.';
        recvProgressLabel.textContent = 'Completed!';

        // Create Blob from ordered chunks
        const fullFileBlob = new Blob(downloadedChunks);
        assembledFileUrl = URL.createObjectURL(fullFileBlob);

        // Show Download Button
        downloadFileBtn.classList.remove('hidden');

        // Notify server that download completed
        try {
            await fetch('/api/complete-transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: sessionCode })
            });
        } catch (e) {
            console.error('Failed to notify server of transfer completion.', e);
        }

        showToast('Transfer completed! Click download to save file.', 'success');
    }

    // Trigger File Download
    downloadFileBtn.addEventListener('click', () => {
        if (!assembledFileUrl) return;
        const a = document.createElement('a');
        a.href = assembledFileUrl;
        a.download = metadata.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    // Helper functions
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

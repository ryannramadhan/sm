// script.js (updated version - preserves all original code and adds group support)

const socket = io();

let config = {};
let currentMessageIndex = null;
let isConnecting = false;

let currentMediaFile = null;
let uploadedMediaUrl = null;

const sessionModal = document.getElementById('sessionModal');
const qrSection = document.getElementById('qrSection');
const qrCode = document.getElementById('qrCode');
const qrCodeModal = document.getElementById('qrCodeModal');
const statusIndicator = document.getElementById('statusIndicator');
const startBot = document.getElementById('startBot');
const stopBot = document.getElementById('stopBot');
const shutdownBtn = document.getElementById('shutdownBtn');
const logsSidebar = document.getElementById('logsSidebar');
const logsContainer = document.getElementById('logsContainer');
const clearLogs = document.getElementById('clearLogs');

const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

const messageModal = document.getElementById('messageModal');
const messageForm = document.getElementById('messageForm');
const cancelMessage = document.getElementById('cancelMessage');
const addMessage = document.getElementById('addMessage');
const messagesList = document.getElementById('messagesList');

const recipientsTextarea = document.getElementById('recipientsTextarea');
const updateRecipients = document.getElementById('updateRecipients');
const recipientsList = document.getElementById('recipientsList');

const messageModeRadios = document.querySelectorAll('input[name="messageMode"]');
const mentionModeRadios = document.querySelectorAll('input[name="mentionMode"]');
const fixedMessageSelect = document.getElementById('fixedMessageSelect');
const minDelay = document.getElementById('minDelay');
const maxDelay = document.getElementById('maxDelay');
const saveConfig = document.getElementById('saveConfig');

const fileUploadArea = document.getElementById('fileUploadArea');
const mediaFile = document.getElementById('mediaFile');
const mediaPreview = document.getElementById('mediaPreview');
const previewImage = document.getElementById('previewImage');
const previewVideo = document.getElementById('previewVideo');
const previewSource = document.getElementById('previewSource');
const previewName = document.getElementById('previewName');
const previewSize = document.getElementById('previewSize');
const removeMedia = document.getElementById('removeMedia');

// ===== Novos elementos para modo Grupo (compatível com input ou select) =====
const recipientModeRadios = document.querySelectorAll('input[name="recipientMode"]');
const groupJidInput = document.getElementById('groupJidInput'); // existe no seu index.html atual
const groupSelect = document.getElementById('groupSelect'); // caso você adicione um <select id="groupSelect">
const groupRecipientsSection = document.getElementById('groupRecipientsSection');
const manualRecipientsSection = document.getElementById('manualRecipientsSection');
// =======================================================================

document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await checkSession();
    await loadGroups(); // tenta carregar grupos (se a rota /api/groups existir)
    setupEventListeners();
});


function showProgress(text, percent) {
    progressContainer.classList.remove('hidden');
    progressText.textContent = text;
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
}

function hideProgress() {
    progressContainer.classList.add('hidden');
}

function updateProgress(text, percent) {
    progressText.textContent = text;
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
}


async function startWhatsAppConnection() {
    if (isConnecting) {
        return;
    }

    try {
        isConnecting = true;
        const response = await fetch('/api/start-connection', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            addLog('WhatsApp connection started for QR Code', 'info');
        } else {
            addLog(`Error starting connection: ${result.message}`, 'error');
        }
    } catch (error) {
        addLog('Error starting WhatsApp connection', 'error');
    } finally {
        isConnecting = false;
    }
}

async function checkSession() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();

        config.hasSession = status.hasSession;
        config.running = status.running;

        if (!status.hasSession) {
            sessionModal.classList.remove('hidden');

            if (!status.running && !isConnecting && !status.isConnecting) {
                await startWhatsAppConnection();
            }
        } else {
            sessionModal.classList.add('hidden');
        }

        if (status.qr) {
            qrCodeModal.innerHTML = `<img src="${status.qr}" alt="QR Code" style="max-width: 100%; height: auto;">`;
        }

        updateStatus(status);
    } catch (error) {
        console.error('Error checking session:', error);
    }
}

function updateStatus(status) {
    const indicator = statusIndicator.querySelector('.status-dot');
    const text = statusIndicator.querySelector('.status-text');

    if (status.hasSession) {
        indicator.className = 'status-dot status-connected';
        text.textContent = 'Connected';
    } else {
        indicator.className = 'status-dot status-disconnected';
        text.textContent = 'Disconnected';
    }

    if (status.running) {
        startBot.disabled = true;
        stopBot.disabled = false;
    } else {
        startBot.disabled = false;
        stopBot.disabled = true;
    }

    if (status.qr) {
        showQRCode(status.qr);
    } else {
        hideQRCode();
    }
}


function showQRCode(qrDataURL) {
    if (qrDataURL) {
        qrCodeModal.innerHTML = `<img src="${qrDataURL}" alt="QR Code" style="max-width: 100%; height: auto;">`;

        if (!config.hasSession) {
            sessionModal.classList.remove('hidden');
        }
    } else {
        hideQRCode();
    }
}

function hideQRCode() {
    qrSection.classList.add('hidden');
    if (config.hasSession) {
        sessionModal.classList.add('hidden');
    }
}


function cleanMediaData() {
    if (config.messages) {
        config.messages.forEach(message => {
            if (message.media) {
                const hasMedia = message.media.path && message.media.path.trim() !== '';
                message.media.enabled = Boolean(hasMedia);

                if (!hasMedia) {
                    message.media.path = '';
                }
            }
        });
    }
}

async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        const configData = await response.json();

        const hasSession = config.hasSession;
        const running = config.running;

        config = configData;

        cleanMediaData();

        if (hasSession !== undefined) config.hasSession = hasSession;
        if (running !== undefined) config.running = running;

        updateUI();
    } catch (error) {
        console.error('Error loading configuration:', error);
        addLog('Error loading configuration', 'error');
    }
}

async function saveConfiguration() {
    try {
        cleanMediaData();

        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        if (response.ok) {
            addLog('Configuration saved successfully', 'success');
        } else {
            addLog('Erro ao salvar configuração', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar configuração:', error);
        addLog('Erro ao salvar configuração', 'error');
    }
}

function updateUI() {
    updateMessagesList();
    updateRecipientsList();
    updateSettingsForm();
    updateFixedMessageSelect();
}


function updateMessagesList() {
    messagesList.innerHTML = '';

    config.messages.forEach((message, index) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-card';

        let mediaPreview = '';
        if (message.media.enabled && message.media.path) {
            const fileName = message.media.path.split('/').pop();
            const isImage = /\.(jpg|jpeg|png|gif)$/i.test(fileName);
            const isVideo = /\.(mp4|mov|avi|webm)$/i.test(fileName);

            if (isImage) {
                mediaPreview = `
                    <div class="message-media-preview">
                        <img src="${message.media.path}" alt="${fileName}" class="media-thumbnail">
                        <span class="media-name">${fileName}</span>
                    </div>
                `;
            } else if (isVideo) {
                mediaPreview = `
                    <div class="message-media-preview">
                        <video class="media-thumbnail" muted>
                            <source src="${message.media.path}" type="video/mp4">
                        </video>
                        <span class="media-name">${fileName}</span>
                    </div>
                `;
            } else {
                mediaPreview = `<p class="message-media">📎 ${fileName}</p>`;
            }
        }

        messageDiv.innerHTML = `
            <div class="message-content">
                <h4 class="message-name">${message.name}</h4>
                <p class="message-preview">${message.text.substring(0, 100)}${message.text.length > 100 ? '...' : ''}</p>
                ${mediaPreview}
            </div>
            <div class="message-actions">
                <button onclick="editMessage(${index})" class="action-btn edit-btn">
                    <i class='bx bx-edit'></i>Edit
                </button>
                <button onclick="deleteMessage(${index})" class="action-btn delete-btn">
                    <i class='bx bx-trash'></i>Delete
                </button>
            </div>
        `;
        messagesList.appendChild(messageDiv);
    });

    updateFixedMessageSelect();
}

function updateFixedMessageSelect() {
    fixedMessageSelect.innerHTML = '<option value="0">Select a message</option>';

    config.messages.forEach((message, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = message.name;

        if (index === config.settings.messageSelection.fixedIndex) {
            option.selected = true;
        }

        fixedMessageSelect.appendChild(option);
    });
}

async function editMessage(index) {
    currentMessageIndex = index;
    const message = config.messages[index];

    document.getElementById('messageName').value = message.name;
    document.getElementById('messageText').value = message.text;

    if (message.media.enabled && message.media.path) {
        await showExistingMediaPreview(message.media.path);
    } else {
        hideMediaPreview();
        currentMediaFile = null;
        uploadedMediaUrl = null;
    }

    messageModal.classList.remove('hidden');
}

function deleteMessage(index) {
    if (confirm('Are you sure you want to delete this message?')) {
        config.messages.splice(index, 1);
        updateMessagesList();
        saveConfiguration();
    }
}

function addNewMessage() {
    currentMessageIndex = null;
    messageForm.reset();
    hideMediaPreview();
    currentMediaFile = null;
    uploadedMediaUrl = null;
    messageModal.classList.remove('hidden');
}


// ===== Modificada para suportar modo Grupo (preservando comportamento anterior) =====
function updateRecipientsList() {
    // Se estiver em modo grupo, mostra resumo do grupo selecionado
    const useGroup = config.settings && config.settings.useGroup;
    const groupJid = config.settings && config.settings.groupJid;

    if (useGroup) {
        let groupInfoHtml = `
            <div class="summary-card">
                <span class="summary-label">Mode:</span>
                <span class="summary-count">Group</span>
            </div>
            <div class="summary-card">
                <span class="summary-label">Group JID:</span>
                <span class="summary-count">${groupJid && groupJid.length ? groupJid : '(not defined)'}</span>
            </div>
        `;
        recipientsList.innerHTML = groupInfoHtml;

        // esconder textarea manual (se existir)
        if (manualRecipientsSection) {
            manualRecipientsSection.classList.add('hidden');
        }
        if (groupRecipientsSection) {
            groupRecipientsSection.classList.remove('hidden');
        }

    } else {
        // comportamento original: preencher textarea com lista de recipients
        recipientsTextarea.value = (config.recipients || []).join('\n');

        recipientsList.innerHTML = `
            <div class="summary-card">
                <span class="summary-label">Total recipients:</span>
                <span class="summary-count">${(config.recipients || []).length}</span>
            </div>
        `;

        // mostrar textarea manual (se existir)
        if (manualRecipientsSection) {
            manualRecipientsSection.classList.remove('hidden');
        }
        if (groupRecipientsSection) {
            groupRecipientsSection.classList.add('hidden');
        }
    }
}



function updateRecipientsFromTextarea() {
    const textareaValue = recipientsTextarea.value.trim();

    if (!textareaValue) {
        config.recipients = [];
        updateRecipientsList();
        saveConfiguration();
        return;
    }

    const lines = textareaValue.split('\n').filter(line => line.trim() !== '');

    const validRecipients = [];
    const invalidLines = [];

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();

        if (/^[\d\s+]+$/.test(trimmedLine) && trimmedLine.length >= 10) {
            validRecipients.push(trimmedLine);
        } else {
            invalidLines.push(`Line ${index + 1}: ${trimmedLine} (invalid format)`);
        }
    });

    if (invalidLines.length > 0) {
        alert(`Invalid format in the following lines:\n${invalidLines.join('\n')}\n\nUse valid phone numbers (ex: 6281234567890 or +6281234567890)`);
        return;
    }

    config.recipients = validRecipients;
    updateRecipientsList();
    saveConfiguration();
    addLog(`Recipients updated: ${validRecipients.length} valid`, 'success');
}


function updateSettingsForm() {
    const settings = config.settings;

    document.querySelector(`input[name="messageMode"][value="${settings.messageSelection.mode}"]`).checked = true;
    document.querySelector(`input[name="mentionMode"][value="${settings.mentionMode || 'grouped'}"]`).checked = true;
    fixedMessageSelect.value = settings.messageSelection.fixedIndex;

    minDelay.value = settings.delay.min;
    maxDelay.value = settings.delay.max;

    // ===== Ajuste para modo de destinatários (manual x grupo) =====
    try {
        if (settings.useGroup) {
            // marca radio group
            const radioGroup = document.querySelector('input[name="recipientMode"][value="group"]');
            if (radioGroup) radioGroup.checked = true;
            if (groupRecipientsSection) groupRecipientsSection.classList.remove('hidden');
            if (manualRecipientsSection) manualRecipientsSection.classList.add('hidden');
            if (groupSelect && settings.groupJid) {
                groupSelect.value = settings.groupJid;
            }
            if (groupJidInput) {
                groupJidInput.value = settings.groupJid || '';
            }
        } else {
            const radioManual = document.querySelector('input[name="recipientMode"][value="manual"]');
            if (radioManual) radioManual.checked = true;
            if (groupRecipientsSection) groupRecipientsSection.classList.add('hidden');
            if (manualRecipientsSection) manualRecipientsSection.classList.remove('hidden');
        }
    } catch (err) {
        // não bloquear se algo faltar no DOM
        console.warn('updateSettingsForm: recipient mode element not found', err);
    }
    // ================================================================
}

function updateSettingsFromForm() {
    const selectedMode = document.querySelector('input[name="messageMode"]:checked').value;
    const selectedMentionMode = document.querySelector('input[name="mentionMode"]:checked').value;

    config.settings.messageSelection.mode = selectedMode;
    config.settings.messageSelection.fixedIndex = parseInt(fixedMessageSelect.value) || 0;
    config.settings.mentionMode = selectedMentionMode;
    config.settings.delay.min = parseInt(minDelay.value) || 2;
    config.settings.delay.max = parseInt(maxDelay.value) || 5;

    // ===== Grupo ou lista manual =====
    try {
        const recipientMode = document.querySelector('input[name="recipientMode"]:checked').value;
        if (recipientMode === 'group') {
            config.settings.useGroup = true;
            // Prioriza select (se existir), senão usa input manual
            if (groupSelect && groupSelect.value) {
                config.settings.groupJid = groupSelect.value;
            } else if (groupJidInput && groupJidInput.value.trim()) {
                config.settings.groupJid = groupJidInput.value.trim();
            } else {
                config.settings.groupJid = '';
            }
            // Quando estiver em modo grupo, não sobrescrever recipients manualmente
        } else {
            config.settings.useGroup = false;
            // se voltar para manual, atualiza lista a partir do textarea
            updateRecipientsFromTextarea();
            config.settings.groupJid = '';
        }
    } catch (err) {
        console.warn('updateSettingsFromForm: error reading recipient mode', err);
    }
    // =================================
}


function addLog(message, type = 'info') {
    const logDiv = document.createElement('div');
    logDiv.className = `log-entry ${type === 'error' ? 'log-error' :
        type === 'success' ? 'log-success' :
            type === 'warning' ? 'log-warning' : 'log-info'
        }`;

    const timestamp = new Date().toLocaleTimeString();
    const icon = type === 'error' ? 'bx-error' :
        type === 'success' ? 'bx-check-circle' :
            type === 'warning' ? 'bx-error-circle' : 'bx-info-circle';

    logDiv.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> <i class='bx ${icon} log-icon'></i>${message}`;

    logsContainer.insertBefore(logDiv, logsContainer.firstChild);

    while (logsContainer.children.length > 50) {
        logsContainer.removeChild(logsContainer.lastChild);
    }
}

async function clearAllLogs() {
    try {
        const response = await fetch('/api/clear-logs', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            logsContainer.innerHTML = '';
        } else {
            addLog('Error clearing logs', 'error');
        }
    } catch (error) {
        addLog('Error clearing logs', 'error');
    }
}


function setupEventListeners() {
    startBot.addEventListener('click', async () => {
        try {
            showProgress('Starting bot...', 10);
            addLog('Starting bot...', 'info');

            const response = await fetch('/api/start', { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                updateProgress('Bot started successfully!', 100);
                addLog('Bot started', 'success');
            } else {
                hideProgress();
                addLog(`${result.message}`, 'error');
            }
        } catch (error) {
            hideProgress();
            addLog('Error starting bot', 'error');
        }
    });


    stopBot.addEventListener('click', async () => {
        try {
            addLog('⏹️ Stopping bot...', 'info');
            const response = await fetch('/api/stop', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                addLog('✅ Bot stopped successfully', 'success');
                hideProgress();
            } else {
                addLog(`${result.message}`, 'error');
            }
        } catch (error) {
            addLog('Erro ao parar bot', 'error');
        }
    });

    shutdownBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to shutdown the application?')) {
            try {
                addLog('Shutting down application...', 'warning');
                const response = await fetch('/api/shutdown', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    addLog('Application shut down', 'info');
                    setTimeout(() => {
                        window.close();
                    }, 1000);
                } else {
                    addLog(`${result.message}`, 'error');
                }
            } catch (error) {
                addLog('Error shutting down application', 'error');
            }
        }
    });


    clearLogs.addEventListener('click', clearAllLogs);

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;

            tabButtons.forEach(btn => {
                btn.classList.remove('tab-active');
            });
            button.classList.add('tab-active');

            tabContents.forEach(content => {
                content.classList.add('hidden');
            });
            document.getElementById(`${tabName}Tab`).classList.remove('hidden');
        });
    });

    addMessage.addEventListener('click', addNewMessage);
    cancelMessage.addEventListener('click', () => {
        messageModal.classList.add('hidden');
    });

    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveMessage();
    });


    updateRecipients.addEventListener('click', updateRecipientsFromTextarea);

    saveConfig.addEventListener('click', () => {
        updateSettingsFromForm();
        saveConfiguration();
        updateRecipientsList();
    });

    // Adicionar listener para o modo de menções
    mentionModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'single') {
                alert('⚠️ WARNING: The "Single (all mentions in one story)" mode has not been fully tested yet.\n\nThis mode is still in development and may present unexpected behavior.\n\nWe recommend using the "Grouped (5 mentions per story)" mode which is fully functional and follows Meta\'s recommendations.');
            }
        });
    });

    // ===== Listeners para modo de destinatários (manual / grupo) =====
    try {
        recipientModeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'group') {
                    // show group section, hide manual
                    if (groupRecipientsSection) groupRecipientsSection.classList.remove('hidden');
                    if (manualRecipientsSection) manualRecipientsSection.classList.add('hidden');
                    // load groups (if select exists)
                    loadGroups();
                } else {
                    if (groupRecipientsSection) groupRecipientsSection.classList.add('hidden');
                    if (manualRecipientsSection) manualRecipientsSection.classList.remove('hidden');
                }
            });
        });
    } catch (err) {
        // se o DOM não tiver os radios, ignora
    }

    // Save group button (if exists)
    const updateGroupBtn = document.getElementById('updateGroup');
    if (updateGroupBtn) {
        updateGroupBtn.addEventListener('click', async () => {
            // salva o groupJid selecionado (prioriza select)
            if (!config.settings) config.settings = {};
            if (groupSelect && groupSelect.value) {
                config.settings.groupJid = groupSelect.value;
            } else if (groupJidInput && groupJidInput.value.trim()) {
                config.settings.groupJid = groupJidInput.value.trim();
            }
            config.settings.useGroup = true;
            await saveConfiguration();
            updateRecipientsList();
            addLog('Group saved in settings', 'success');
        });
    }

    setupUploadListeners();
}

function toggleMediaSection() {
}


async function uploadFile(file) {
    const formData = new FormData();
    formData.append('media', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            uploadedMediaUrl = result.fileUrl;
            addLog(`📁 Arquivo enviado: ${result.originalName}`, 'success');
            return result;
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        addLog(`❌ Erro no upload: ${error.message}`, 'error');
        throw error;
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showMediaPreview(file) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (isImage) {
        previewImage.src = URL.createObjectURL(file);
        previewImage.classList.remove('hidden');
        previewVideo.classList.add('hidden');
    } else if (isVideo) {
        previewSource.src = URL.createObjectURL(file);
        previewVideo.load();
        previewVideo.classList.remove('hidden');
        previewImage.classList.add('hidden');
    }

    previewName.textContent = file.name;
    previewSize.textContent = formatFileSize(file.size);
    mediaPreview.classList.remove('hidden');
}

function hideMediaPreview() {
    mediaPreview.classList.add('hidden');
    previewImage.classList.add('hidden');
    previewVideo.classList.add('hidden');
    previewImage.src = '';
    previewSource.src = '';
    currentMediaFile = null;
    uploadedMediaUrl = null;
}

async function showExistingMediaPreview(mediaPath) {
    // Extrair nome do arquivo do caminho
    const fileName = mediaPath.split('/').pop();

    // Determinar se é imagem ou vídeo pela extensão
    const isImage = /\.(jpg|jpeg|png|gif)$/i.test(fileName);
    const isVideo = /\.(mp4|mov|avi|webm)$/i.test(fileName);

    if (isImage) {
        previewImage.src = mediaPath;
        previewImage.classList.remove('hidden');
        previewVideo.classList.add('hidden');
    } else if (isVideo) {
        previewSource.src = mediaPath;
        previewVideo.load();
        previewVideo.classList.remove('hidden');
        previewImage.classList.add('hidden');
    }

    previewName.textContent = fileName;

    // Tentar obter o tamanho real do arquivo
    try {
        const response = await fetch(mediaPath, { method: 'HEAD' });
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            previewSize.textContent = formatFileSize(parseInt(contentLength));
        } else {
            previewSize.textContent = 'Existing file';
        }
    } catch (error) {
        previewSize.textContent = 'Arquivo existente';
    }

    mediaPreview.classList.remove('hidden');

    // Definir a URL como a mídia existente
    uploadedMediaUrl = mediaPath;
}

function setupUploadListeners() {
    // Click to select file
    fileUploadArea.addEventListener('click', (e) => {
        e.preventDefault();
        mediaFile.click();
    });

    // Prevent double click on input
    mediaFile.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Drag and drop
    fileUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileUploadArea.classList.add('dragover');
    });

    fileUploadArea.addEventListener('dragleave', () => {
        fileUploadArea.classList.remove('dragover');
    });

    fileUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        fileUploadArea.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    // File selection
    mediaFile.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    // Remove media
    removeMedia.addEventListener('click', () => {
        hideMediaPreview();
        mediaFile.value = '';
    });
}

async function handleFileSelect(file) {
    // Validate file type
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
    const isValidType = allowedTypes.test(file.type);

    if (!isValidType) {
        addLog('❌ Unsupported file type', 'error');
        return;
    }

    // Validate size (50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
        addLog('❌ File too large (max. 50MB)', 'error');
        return;
    }

    currentMediaFile = file;
    showMediaPreview(file);

    // Automatic upload
    try {
        await uploadFile(file);
    } catch (error) {
        addLog(`❌ Erro no upload: ${error.message}`, 'error');
    }
}

function saveMessage() {
    const name = document.getElementById('messageName').value;
    const text = document.getElementById('messageText').value;

    const hasMedia = uploadedMediaUrl && uploadedMediaUrl.trim() !== '';

    const message = {
        name,
        text,
        media: {
            enabled: Boolean(hasMedia),
            path: uploadedMediaUrl || ''
        }
    };

    if (currentMessageIndex !== null) {
        config.messages[currentMessageIndex] = message;
    } else {
        config.messages.push(message);
    }

    messageModal.classList.add('hidden');
    updateMessagesList();
    saveConfiguration();

    if (!hasMedia) {
        hideMediaPreview();
        currentMediaFile = null;
        uploadedMediaUrl = null;
    }
}


socket.on('connect', () => {
});

socket.on('disconnect', () => {
});

socket.on('qr', (qrDataURL) => {
    if (qrDataURL) {
        showQRCode(qrDataURL);
    } else {
        hideQRCode();
    }
});

socket.on('log', (logEntry) => {
    addLog(logEntry.message, logEntry.type);
});

socket.on('logs', (logs) => {
    logs.reverse().forEach(log => {
        addLog(log.message, log.type);
    });
});

socket.on('progress', (progressData) => {
    if (progressData.hide) {
        hideProgress();
    } else {
        updateProgress(progressData.text, progressData.percent);
    }
});

socket.on('logs-cleared', () => {
    logsContainer.innerHTML = '';
});

// ===== Função para carregar grupos via API (se disponível) =====
async function loadGroups() {
    // Só tenta se houver algo no DOM para preencher
    if (!groupSelect && !groupJidInput) return;

    try {
        const res = await fetch('/api/groups');
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!data.success) {
            addLog(`Could not load groups: ${data.message || 'error'}`, 'warning');
            // preencher select com erro se existir
            if (groupSelect) groupSelect.innerHTML = `<option value="">${data.message || 'Error loading groups'}</option>`;
            return;
        }

        const groups = data.groups || [];

        if (groupSelect) {
            // limpar e preencher select
            groupSelect.innerHTML = `<option value="">-- Select a group --</option>`;
            groups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = `${g.subject || g.id} (${g.participants || 0} members)`;
                groupSelect.appendChild(opt);
            });

            // definir valor atual se já configurado
            if (config.settings && config.settings.groupJid) {
                groupSelect.value = config.settings.groupJid;
            }
        }

        // se não há select, manter input manual preenchido (se houver)
        if (!groupSelect && groupJidInput && config.settings && config.settings.groupJid) {
            groupJidInput.value = config.settings.groupJid;
        }

        addLog(`🗂️ ${groups.length} groups loaded`, 'info');
    } catch (error) {
        // falha silenciosa (não quebra UI)
        addLog(`❌ Error loading groups: ${error.message}`, 'error');
        if (groupSelect) {
            groupSelect.innerHTML = `<option value="">Failed to load groups</option>`;
        }
    }
}
// ===============================================================

setInterval(checkSession, 5000);

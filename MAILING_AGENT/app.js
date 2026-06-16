/* ================================================================
   app.js — 메일링 에이전트 AI 메인 로직
   ================================================================
   [SAFETY POLICY REF]
   - Rule 3: sendMail은 showPreview 미리보기 + 사용자 확인 버튼 필수 (app.js에서 게이트)
   - Rule 7: 비상 정지 버튼 (stopBtn)
   ================================================================ */

'use strict';

// =============================================================
//  1. DOM REFS
// =============================================================
const messagesEl   = document.getElementById('chatMessages');
const textarea     = document.getElementById('chatTextarea');
const sendBtn      = document.getElementById('sendBtn');
const clearBtn     = document.getElementById('clearBtn');
const stopBtn      = document.getElementById('stopBtn');
const typingEl     = document.getElementById('typingIndicator');
const quickActions = document.getElementById('quickActions');
const stepIndicator = document.getElementById('stepIndicator');
const statusText   = document.getElementById('statusText');
const taoBody      = document.getElementById('taoBody');
const taoEmpty     = document.getElementById('taoEmpty');
const taoToggle    = document.getElementById('taoToggle');
const taoPanel     = document.getElementById('taoPanel');

// =============================================================
//  2. PARTICLES INIT (로컬에서 직접 처리)
// =============================================================
(function initParticles() {
    const container = document.getElementById('particles');
    for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 4 + 2;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDuration = (Math.random() * 20 + 15) + 's';
        p.style.animationDelay = (Math.random() * 20) + 's';
        container.appendChild(p);
    }
})();

// =============================================================
//  3. AGENT STATE (5 Elements)
// =============================================================
const state = {
    // --- Goal ---
    goal: '사용자의 요청을 바탕으로 메일을 작성하고, 친구 메일 주소로만 Mock 발송한다.',

    // --- Plan ---
    plan: '사용자 요청 대기 중',

    // --- State ---
    request:        '',       // 사용자 요청
    recipient:      '',       // 받는 사람
    subject:        '',       // 제목
    keyContent:     [],       // 본문 핵심 내용
    missingInfo:    [],       // 부족한 정보 목록
    draft:          null,     // 생성된 메일 초안
    mockResult:     null,     // Mock 발송 결과
    step: 'idle',   // idle | collecting | composing | preview | confirming | sent

    // --- Tools (tools.js에 정의) ---
    // --- Result ---
};

// =============================================================
//  4. MISC STATE
// =============================================================
let isProcessing = false;
let isStopped = false;
let pendingSendDraft = null;   // sendMail 승인 대기 중인 draft

// =============================================================
//  5. TAO LOGGING
// =============================================================
let taoEntries = [];

function addTaoEntry(type, content, toolName) {
    // Rule 7: 중지 상태에서는 로깅 안 함
    if (isStopped && type !== 'observation') return;

    taoEmpty.style.display = 'none';
    const entry = { type, content, toolName, timestamp: new Date() };
    taoEntries.push(entry);
    renderTaoEntry(entry);
}

function renderTaoEntry(entry) {
    const div = document.createElement('div');
    div.className = 'tao-entry';

    const step = document.createElement('div');
    step.className = 'tao-step t-' + entry.type;

    const labelMap = {
        thought:      '🤔 T',
        action:       '⚡ A',
        observation:  '📋 O'
    };
    step.textContent = labelMap[entry.type] || entry.type;

    if (entry.toolName) {
        const badge = document.createElement('span');
        badge.className = 'tool-badge ' + entry.toolName;
        badge.textContent = entry.toolName;
        step.appendChild(badge);
    }

    const content = document.createElement('div');
    content.className = 'tao-content';
    content.textContent = entry.content;

    div.appendChild(step);
    div.appendChild(content);
    taoBody.appendChild(div);
    taoBody.scrollTop = taoBody.scrollHeight;
}

function clearTaoLog() {
    taoEntries = [];
    taoBody.querySelectorAll('.tao-entry').forEach(el => el.remove());
    taoEmpty.style.display = 'block';
}

// =============================================================
//  6. UI HELPERS
// =============================================================

function updateStatus(text, stepText) {
    statusText.textContent = text;
    if (stepText) stepIndicator.textContent = stepText;
}

function showTyping() {
    typingEl.classList.add('active');
    scrollToBottom();
}

function hideTyping() {
    typingEl.classList.remove('active');
}

function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Render message in chat
 * @param {'user'|'bot'} role
 * @param {string} htmlContent
 */
function renderMessage(role, htmlContent) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'bot' ? '📧' : '😊';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = htmlContent.replace(/\n/g, '<br>');

    const time = document.createElement('span');
    time.className = 'time';
    const now = new Date();
    time.textContent = now.getHours().toString().padStart(2, '0') + ':' +
                       now.getMinutes().toString().padStart(2, '0');
    bubble.appendChild(time);

    div.appendChild(avatar);
    div.appendChild(bubble);
    messagesEl.appendChild(div);
    scrollToBottom();
}

/**
 * Build rejection HTML (Rule 6 거부 형식: 거부 사실 + 사유 + 대안)
 */
function buildRejectionHtml(reason, altSuggestion) {
    const alt = altSuggestion || '존중하는 표현으로 바꿔서 다시 요청해주세요.';
    return `<div class="rejection-box">
        <div class="rej-title">🚫 요청이 거부되었습니다.</div>
        <div class="rej-reason">📌 사유: ${reason}</div>
        <div class="rej-alt">💡 대안: ${alt}</div>
    </div>`;
}

/**
 * Build send result HTML
 */
function buildResultHtml(result) {
    return `<div class="mock-toast">📨 <strong>Mock 발송 결과</strong><br>
        상태: ✅ ${result.status}<br>
        받는 사람: ${result.to}<br>
        제목: ${result.subject}<br>
        발송 시간: ${new Date(result.sentAt).toLocaleString('ko-KR')}<br>
        Message ID: <span class="msg-id">${result.messageId}</span>
    </div>`;
}

// =============================================================
//  7. QUICK ACTIONS
// =============================================================
const QUICK_ACTIONS = [
    '메일 작성해줘',
    '회의 초대 메일 작성',
    '감사 메일 작성',
    '안내 메일 작성'
];

function buildQuickActions() {
    quickActions.innerHTML = '';
    QUICK_ACTIONS.forEach(text => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = text;
        chip.addEventListener('click', () => {
            if (!isProcessing && !isStopped) {
                agentProcess(text);
            }
        });
        quickActions.appendChild(chip);
    });
}

// =============================================================
//  8. LOCAL STORAGE
// =============================================================
const HISTORY_KEY = 'mailing_agent_history';

function saveHistory() {
    const items = messagesEl.querySelectorAll('.msg');
    const history = [];
    items.forEach(el => {
        const role = el.classList.contains('bot') ? 'bot' : 'user';
        const textEl = el.querySelector('.bubble');
        if (!textEl) return;
        const clone = textEl.cloneNode(true);
        const timeSpan = clone.querySelector('.time');
        if (timeSpan) timeSpan.remove();
        history.push({ role, text: clone.innerHTML.replace(/<br>/g, '\n') });
    });
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch(e) {}
}

function loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return false;
        const history = JSON.parse(raw);
        if (!Array.isArray(history) || history.length === 0) return false;
        history.forEach(item => {
            renderMessage(item.role, item.text);
        });
        scrollToBottom();
        return true;
    } catch(e) { return false; }
}

// =============================================================
//  9. AGENT CORE LOGIC
// =============================================================

function resetState() {
    state.recipient = '';
    state.subject = '';
    state.keyContent = [];
    state.missingInfo = [];
    state.draft = null;
    state.mockResult = null;
    state.step = 'idle';
    pendingSendDraft = null;
    window.__tools.resetRetryState();
    updateStatus('대기 중', '💡 메일 작성을 도와드립니다');
}

/**
 * 메인 에이전트 루프 — 사용자 메시지 처리
 */
function agentProcess(userMessage) {
    const msg = userMessage.trim();
    if (!msg) return;

    // Rule 7: 중지 상태 리셋
    isStopped = false;
    stopBtn.style.display = 'inline-block';

    // Rule 6: 콘텐츠 필터 검증
    const filterResult = window.__tools.checkContentFilter(msg);
    if (filterResult.blocked) {
        addTaoEntry('thought', `사용자 입력 검증 중 → '${filterResult.type}' 패턴 감지`, null);
        addTaoEntry('action', '(거부 — 도구 실행 안 함)', null);
        addTaoEntry('observation', `🚫 ${filterResult.type} 표현 감지로 요청 거부됨`, null);
        renderMessage('user', msg);
        renderMessage('bot', buildRejectionHtml(filterResult.reason));
        saveHistory();
        isProcessing = false;
        sendBtn.disabled = false;
        textarea.focus();
        stopBtn.style.display = 'none';
        return;
    }

    // 사용자 메시지 기록
    renderMessage('user', msg);
    saveHistory();

    isProcessing = true;
    sendBtn.disabled = true;
    showTyping();
    updateStatus('처리 중...', '🤔 분석 중');

    setTimeout(() => {
        hideTyping();
        if (isStopped) { cleanupAfterStop(); return; }
        runAgent(msg);
    }, 400);
}

function cleanupAfterStop() {
    stopBtn.style.display = 'none';
    isProcessing = false;
    sendBtn.disabled = false;
    textarea.focus();
}

/**
 * 에이전트 상태 머신
 */
function runAgent(userMsg) {
    // Rule 7: 중지 체크
    if (isStopped) { cleanupAfterStop(); return; }

    // ----- 1) 수집 단계 -----
    if (state.step === 'idle' || state.step === 'collecting') {
        if (state.step === 'idle') {
            state.request = userMsg;
            state.step = 'collecting';
            updateStatus('정보 수집 중...', '📝 정보를 수집하고 있습니다');

            addTaoEntry('thought', `사용자 요청 분석: "${userMsg.substring(0, 30)}..." → 정보 수집 필요`, null);
            addTaoEntry('action', '정보 요청 — 받는 사람 입력 대기', 'composeMail');

            const q = '메일을 작성하기 위해 다음 정보가 필요합니다:\n\n📌 **받는 사람**의 이메일 주소를 알려주세요!\n\n(친구 메일만 가능: sunny.ichmhs@gmail.com / 2025gs11023@gosaek.hs.kr / 2026gs20511@gosaek.hs.kr)';
            renderMessage('bot', q);
            addTaoEntry('observation', '받는 사람 정보 요청 완료. 사용자 응답 대기 중.', null);
            saveHistory();
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }

        // 받는 사람 수집
        if (!state.recipient) {
            state.recipient = userMsg.trim();
            addTaoEntry('observation', `받는 사람: ${state.recipient} 저장 완료`, null);
            renderMessage('bot', '✅ 받는 사람이 저장되었습니다. 이제 **메일 제목**을 알려주세요!');
            saveHistory();
            updateStatus('정보 수집 중...', '📝 제목을 입력해주세요');
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }

        // 제목 수집
        if (!state.subject) {
            state.subject = userMsg.trim();
            addTaoEntry('observation', `제목: ${state.subject} 저장 완료`, null);
            renderMessage('bot', '✅ 제목이 저장되었습니다. 이제 **본문에 포함할 내용**을 알려주세요!\n\n예: "회의 일정 공지, 3월 15일 오전 10시, 줌 링크 포함" 등');
            saveHistory();
            updateStatus('정보 수집 중...', '📝 본문 내용을 입력해주세요');
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }

        // 본문 내용 수집
        if (state.keyContent.length === 0) {
            state.keyContent.push(userMsg.trim());
            addTaoEntry('observation', '본문 내용 저장 완료', null);
            renderMessage('bot', '✅ 본문 내용이 저장되었습니다. 추가로 포함할 내용이 더 있나요?\n\n👉 "없어" 또는 "완료" 라고 말씀해주시면 메일 초안을 작성하겠습니다.\n👉 더 추가하시려면 내용을 입력해주세요.');
            saveHistory();
            updateStatus('정보 수집 중...', '📝 추가 내용이 있나요?');
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }

        // 추가 내용 처리
        if (!userMsg.includes('없어') && !userMsg.includes('완료') && !userMsg.includes('끝')) {
            state.keyContent.push(userMsg.trim());
            renderMessage('bot', '✅ 추가 내용이 저장되었습니다. 더 있나요?\n\n👉 "없어" 또는 "완료" 라고 말씀해주시면 메일 초안을 작성하겠습니다.');
            saveHistory();
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }

        // "없어/완료" → composeMail 실행
        addTaoEntry('thought', '모든 정보 수집 완료. composeMail을 실행합니다.', null);

        const bodyText = state.keyContent.join('\n');
        const result = window.__tools.executeToolSafely(
            'composeMail',
            [state.recipient, state.subject, bodyText],
            addTaoEntry
        );

        if (isStopped) { cleanupAfterStop(); return; }

        if (!result.success) {
            // Rule 4, 5: 실패 처리
            if (result.needsDecision) {
                handleRetryDecision(result);
                return;
            }
            renderMessage('bot', buildRejectionHtml(result.error, '입력 정보를 확인하고 다시 시도해주세요.'));
            saveHistory();
            resetState();
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }

        // 성공 — draft 저장
        state.draft = result.data.draft;
        state.step = 'preview';

        addTaoEntry('thought', 'composeMail 성공. 사용자에게 미리보기를 제공합니다.', null);
        addTaoEntry('action', 'showPreview 실행 — 미리보기 카드 생성', 'showPreview');

        // showPreview 실행 (auto)
        const previewResult = window.__tools.showPreview(state.draft);
        if (!previewResult.success) {
            renderMessage('bot', buildRejectionHtml(previewResult.error));
            saveHistory();
            resetState();
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }

        addTaoEntry('observation', '미리보기 카드 생성 완료. 사용자의 [확인] 대기 중.', null);

        const previewHtml = previewResult.html;
        renderMessage('bot', '✅ 메일 초안이 작성되었습니다. 아래 내용을 확인하고 **✅ 확인** 버튼을 눌러주세요.\n\n' + previewHtml);
        saveHistory();

        // Rule 3: 미리보기 카드의 [확인] 버튼에 이벤트 바인딩
        pendingSendDraft = state.draft;
        attachConfirmListeners();

        state.step = 'confirming';
        updateStatus('확인 대기 중', '📋 [확인] 버튼을 눌러주세요');

        isProcessing = false;
        sendBtn.disabled = false;
        textarea.focus();
        stopBtn.style.display = 'none';
        return;
    }

    // ----- 2) 확인 단계 (confirming) -----
    if (state.step === 'confirming') {
        // 사용자가 텍스트로 "보내줘" 라고 입력한 경우
        if (userMsg.includes('보내') || userMsg.includes('네') || userMsg.includes('응') || userMsg.includes('ok') || userMsg.includes('yes')) {
            executeSendMail();
            return;
        }
        if (userMsg.includes('아니') || userMsg.includes('수정') || userMsg.includes('다시')) {
            state.step = 'collecting';
            state.recipient = '';
            state.subject = '';
            state.keyContent = [];
            state.draft = null;
            pendingSendDraft = null;
            renderMessage('bot', '🔄 처음부터 다시 시작합니다. 먼저 **받는 사람**의 이메일 주소를 알려주세요!');
            saveHistory();
            addTaoEntry('observation', '사용자가 수정 요청 → 정보 수집 재시작', null);
            updateStatus('정보 수집 중...', '📝 받는 사람부터 입력');
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }
        // 수정 필드 지정
        const lowerMsg = userMsg.toLowerCase();
        if (lowerMsg.includes('받는') || lowerMsg.includes('받는사람') || lowerMsg.includes('to')) {
            state.recipient = '';
            state.step = 'collecting';
            state.draft = null; pendingSendDraft = null;
            renderMessage('bot', '🔄 받는 사람을 수정합니다. 새로운 **받는 사람**을 알려주세요!');
            saveHistory();
            addTaoEntry('observation', '받는 사람 수정 요청', null);
        } else if (lowerMsg.includes('제목') || lowerMsg.includes('subject')) {
            state.subject = '';
            state.step = 'collecting';
            state.draft = null; pendingSendDraft = null;
            renderMessage('bot', '🔄 제목을 수정합니다. 새로운 **제목**을 알려주세요!');
            saveHistory();
            addTaoEntry('observation', '제목 수정 요청', null);
        } else if (lowerMsg.includes('본문') || lowerMsg.includes('내용')) {
            state.keyContent = [];
            state.step = 'collecting';
            state.draft = null; pendingSendDraft = null;
            renderMessage('bot', '🔄 본문을 수정합니다. 새로운 **본문 내용**을 알려주세요!');
            saveHistory();
            addTaoEntry('observation', '본문 수정 요청', null);
        } else {
            renderMessage('bot', '🤔 "보내줘" 또는 ❌ "취소" 버튼을 눌러주세요. 수정하려면 "수정"이라고 입력하세요.');
            saveHistory();
        }
        isProcessing = false;
        sendBtn.disabled = false;
        textarea.focus();
        stopBtn.style.display = 'none';
        return;
    }

    // ----- 3) 발송 완료 후 새 요청 -----
    if (state.step === 'sent') {
        resetState();
        state.request = userMsg;
        state.step = 'collecting';
        updateStatus('정보 수집 중...', '📝 정보를 수집하고 있습니다');
        addTaoEntry('thought', '새 메일 작성 요청 수신', null);
        addTaoEntry('action', '정보 요청 — 받는 사람 입력 대기', 'composeMail');
        const q = '새 메일 작성을 시작합니다!\n\n📌 **받는 사람**의 이메일 주소를 알려주세요!\n\n(친구 메일만 가능: sunny.ichmhs@gmail.com / 2025gs11023@gosaek.hs.kr / 2026gs20511@gosaek.hs.kr)';
        renderMessage('bot', q);
        addTaoEntry('observation', '받는 사람 정보 요청 완료', null);
        saveHistory();
        isProcessing = false;
        sendBtn.disabled = false;
        textarea.focus();
        stopBtn.style.display = 'none';
        return;
    }

    // Fallback
    renderMessage('bot', '🤔 무엇을 도와드릴까요? "메일 작성해줘"라고 말씀해주세요!');
    saveHistory();
    isProcessing = false;
    sendBtn.disabled = false;
    textarea.focus();
    stopBtn.style.display = 'none';
}

// =============================================================
//  10. CONFIRM BUTTON (Rule 3 게이트)
// =============================================================

/**
 * 미리보기 카드의 [확인]/[취소] 버튼에 이벤트 리스너 연결
 */
function attachConfirmListeners() {
    // [확인] 버튼
    document.querySelectorAll('.btn-confirm').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (isProcessing || isStopped) return;
            if (pendingSendDraft) {
                executeSendMail();
            }
        });
    });
    // [취소] 버튼
    document.querySelectorAll('.btn-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (isProcessing || isStopped) return;
            renderMessage('bot', '❌ 발송이 취소되었습니다. 새로 작성하려면 다시 요청해주세요.');
            saveHistory();
            addTaoEntry('observation', '사용자가 [취소] 버튼을 클릭했습니다.', null);
            resetState();
            textarea.focus();
        });
    });
}

/**
 * sendMail 실행 (Rule 3 게이트를 통과한 경우만 호출)
 */
function executeSendMail() {
    isProcessing = true;
    sendBtn.disabled = true;
    showTyping();
    updateStatus('발송 처리 중...', '📨 발송 중');

    const draft = pendingSendDraft;
    pendingSendDraft = null;

    setTimeout(() => {
        hideTyping();
        if (isStopped) { cleanupAfterStop(); return; }

        addTaoEntry('thought', '사용자가 [확인]을 클릭했습니다. sendMail을 실행합니다.', null);
        addTaoEntry('action', 'sendMail 실행 — 수신자 검증 후 Mock 발송', 'sendMail');

        const result = window.__tools.executeToolSafely(
            'sendMail',
            [draft],
            addTaoEntry
        );

        if (isStopped) { cleanupAfterStop(); return; }

        if (!result.success) {
            if (result.needsDecision) {
                handleRetryDecision(result);
                return;
            }
            // Rule 2 거부 또는 기타 오류
            renderMessage('bot', buildRejectionHtml(result.error, '친구 메일 주소를 확인하고 다시 시도해주세요.'));
            saveHistory();
            addTaoEntry('observation', `🚫 발송 실패: ${result.error}`, null);
            state.step = 'sent';
            resetState();
            isProcessing = false;
            sendBtn.disabled = false;
            textarea.focus();
            stopBtn.style.display = 'none';
            return;
        }

        // 성공
        const mockResult = result.data.result;
        state.mockResult = mockResult;
        state.step = 'sent';

        addTaoEntry('observation', `✅ 발송 완료! Message ID: ${mockResult.messageId}`, null);

        const resultHtml = buildResultHtml(mockResult);
        renderMessage('bot', '✅ 메일이 성공적으로 발송되었습니다!\n\n' + resultHtml + '\n\n📬 새로운 메일을 작성하려면 새 요청을 입력해주세요.');
        saveHistory();
        updateStatus('발송 완료', '✅ Mock 발송 완료');

        resetState();
        isProcessing = false;
        sendBtn.disabled = false;
        textarea.focus();
        stopBtn.style.display = 'none';
    }, 600);
}

// =============================================================
//  11. RETRY DECISION (Rule 4, 5)
// =============================================================

/**
 * 5회 재시도 실패 후 사용자에게 재시도/종료 결정 요청
 */
function handleRetryDecision(result) {
    addTaoEntry('thought', `사용자에게 '${result.toolName}' 재시도 여부를 묻습니다.`, null);

    renderMessage('bot',
        `⚠️ '${result.toolName}' 실행 중 문제가 발생했습니다.\n\n` +
        `🔍 실패 사유: ${result.error}\n\n` +
        `📌 **"다시"** 라고 입력하면 처음부터 다시 시도합니다.\n` +
        `🛑 **"그만"** 이라고 입력하면 중단합니다.`
    );
    saveHistory();
    updateStatus('재시도 확인 필요', '⚠️ 재시도 또는 종료 선택');

    // 대기 상태 전환
    state.step = 'retry_decision';
    window.__tmpRetryResult = result;

    isProcessing = false;
    sendBtn.disabled = false;
    textarea.focus();
    stopBtn.style.display = 'none';
}

/**
 * 재시도 결정 처리
 */
function handleRetryDecisionInput(userMsg) {
    if (userMsg.includes('다시') || userMsg.includes('재시도')) {
        addTaoEntry('thought', '사용자가 재시도를 요청했습니다. retryState를 초기화하고 다시 시작합니다.', null);
        window.__tools.resetRetryState();
        delete window.__tmpRetryResult;
        renderMessage('bot', '🔄 다시 시도합니다. 처음부터 입력해주세요.');
        saveHistory();
        resetState();
        isProcessing = false;
        sendBtn.disabled = false;
        textarea.focus();
        stopBtn.style.display = 'none';
        return;
    }

    if (userMsg.includes('그만') || userMsg.includes('종료') || userMsg.includes('아니')) {
        addTaoEntry('thought', '사용자가 종료를 선택했습니다. 에이전트를 초기화합니다.', null);
        addTaoEntry('observation', '에이전트가 대기 상태로 복귀했습니다.', null);
        renderMessage('bot', '🛑 중단되었습니다. 새로운 요청을 입력해주세요.');
        saveHistory();
        delete window.__tmpRetryResult;
        resetState();
        isProcessing = false;
        sendBtn.disabled = false;
        textarea.focus();
        stopBtn.style.display = 'none';
        return;
    }

    renderMessage('bot', '🤔 "다시" 또는 "그만"이라고 입력해주세요.');
    saveHistory();
    isProcessing = false;
    sendBtn.disabled = false;
    textarea.focus();
    stopBtn.style.display = 'none';
}

// =============================================================
//  12. STOP BUTTON (Rule 7: 비상 정지)
// =============================================================

stopBtn.addEventListener('click', () => {
    isStopped = true;
    stopBtn.style.display = 'none';
    hideTyping();

    window.__tools.resetRetryState();

    addTaoEntry('thought', '⏹️ 사용자가 비상 정지 버튼을 눌렀습니다. 모든 처리를 중단합니다.', null);
    addTaoEntry('action', '⏹️ 실행 중지', null);
    addTaoEntry('observation', '에이전트가 중단되었습니다. 새 입력을 기다립니다.', null);

    renderMessage('bot', '⏹️ 모든 처리를 중단했습니다. 새로운 요청을 입력해주세요.');
    saveHistory();

    resetState();
    isProcessing = false;
    sendBtn.disabled = false;
    textarea.focus();
});

// =============================================================
//  13. CLEAR
// =============================================================

function clearChat() {
    if (!confirm('대화를 모두 삭제하시겠습니까?')) return;
    messagesEl.innerHTML = '';
    localStorage.removeItem(HISTORY_KEY);
    clearTaoLog();
    resetState();
    pendingSendDraft = null;
    window.__tools.resetRetryState();
    isStopped = false;
    stopBtn.style.display = 'none';

    renderMessage('bot', '안녕하세요! 📧 **메일링 에이전트 AI**입니다.\n\n메일 작성을 도와드립니다. 아래와 같이 요청해주세요!\n\n💡 "메일 작성해줘"\n💡 "회의 초대 메일 작성해줘"\n💡 "감사 메일 보내줘"');
    saveHistory();
    addTaoEntry('thought', '에이전트가 초기화되었습니다. 새 요청을 기다립니다.', null);
}

// =============================================================
//  14. TAO PANEL TOGGLE
// =============================================================

let taoCollapsed = false;
taoToggle.addEventListener('click', () => {
    taoCollapsed = !taoCollapsed;
    taoPanel.classList.toggle('collapsed', taoCollapsed);
    taoToggle.textContent = taoCollapsed ? '▶' : '◀';
    taoToggle.title = taoCollapsed ? 'TAO 패널 펼치기' : 'TAO 패널 접기';
});

// =============================================================
//  15. EVENT BINDING
// =============================================================

function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 110) + 'px';
}

textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const msg = textarea.value;

        // 재시도 결정 대기 상태 처리
        if (state.step === 'retry_decision') {
            textarea.value = '';
            textarea.style.height = 'auto';
            renderMessage('user', msg);
            saveHistory();
            handleRetryDecisionInput(msg);
            return;
        }

        agentProcess(msg);
    }
});
textarea.addEventListener('input', autoResize);

sendBtn.addEventListener('click', () => {
    const msg = textarea.value;

    if (state.step === 'retry_decision') {
        textarea.value = '';
        textarea.style.height = 'auto';
        renderMessage('user', msg);
        saveHistory();
        handleRetryDecisionInput(msg);
        return;
    }

    agentProcess(msg);
});
clearBtn.addEventListener('click', clearChat);

// =============================================================
//  16. INIT
// =============================================================

buildQuickActions();

// TAO 첫 기록
addTaoEntry('thought', '에이전트가 초기화되었습니다. 사용자의 메일 작성 요청을 기다립니다.', null);
addTaoEntry('action', 'composeMail 실행 대기 중', 'composeMail');
addTaoEntry('observation', '시스템 준비 완료. 사용자 메시지를 기다리는 중입니다.', null);

const hasHistory = loadHistory();
if (!hasHistory) {
    renderMessage('bot', '안녕하세요! 📧 **메일링 에이전트 AI**입니다.\n\n메일 작성을 도와드립니다. 아래와 같이 요청해주세요!\n\n💡 "메일 작성해줘"\n💡 "회의 초대 메일 작성해줘"\n💡 "감사 메일 보내줘"\n\n📌 발송 가능한 친구 메일:\n  • sunny.ichmhs@gmail.com\n  • 2025gs11023@gosaek.hs.kr\n  • 2026gs20511@gosaek.hs.kr');
    saveHistory();
}

textarea.focus();
updateStatus('대기 중', '💡 메일 작성을 도와드립니다');
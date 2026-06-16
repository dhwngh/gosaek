/* ================================================================
   tools.js — 메일링 에이전트 도구 정의 + 가드레일
   ================================================================
   [SAFETY POLICY REF]
   - Rule 1: 허용된 3개 도구(composeMail, showPreview, sendMail) 외 호출 시 거부
   - Rule 2: sendMail 수신자는 FRIEND_EMAILS 화이트리스트만 허용
   - Rule 3: sendMail은 showPreview 미리보기 + 사용자 확인 버튼 필수
   - Rule 4: 동일 도구 5회 재시도 제한 (retryState)
   - Rule 5: 실패 시 결과 절대 지어내지 않음
   - Rule 6: 4가지 콘텐츠 필터 (욕설·비방, 차별·혐오, 거짓·기만, 탈옥·우회)
   ================================================================ */

'use strict';

// =============================================================
//  CONSTANTS — 안전 규칙 1, 2
// =============================================================

/** 허용된 3개 도구 목록 (Rule 1) */
const ALLOWED_TOOLS = ['composeMail', 'showPreview', 'sendMail'];

/** 도구 등급 (auto: 즉시 실행, ask: 사용자 승인 필수) */
const TOOL_GRADE = {
    composeMail: 'auto',
    showPreview: 'auto',
    sendMail: 'ask'
};

/** 친구 메일 주소 화이트리스트 (Rule 2) */
const FRIEND_EMAILS = [
    'sunny.ichmhs@gmail.com',
    '2025gs11023@gosaek.hs.kr',
    '2026gs20511@gosaek.hs.kr'
];

/** 최대 재시도 횟수 (Rule 4) */
const MAX_RETRIES = 5;

// =============================================================
//  CONTENT FILTERS — 4가지 입력 필터 (Rule 6)
// =============================================================

const CONTENT_FILTERS = [
    {
        type: '욕설·비방',
        patterns: [
            /시발|씨발|존나|병신|ㄷㅊ|ㅅㅂ|fuck|shit/gi,
            /죽여|뒤져|조져/gi,
            /바보|멍청|등신|머저리/gi
        ]
    },
    {
        type: '차별·혐오',
        patterns: [
            /(여자|남자|외국인|장애인|노인|흑인|백인|동성애|페미|한남|메갈|워마드)\s*(는|은|이|가|을|를).*(~|이|가)\s*(못해|하지마|꺼져|없어|같은|죽어)/gi,
            /(여자|남자|외국인|장애인|흑인)\s*(:|=| -)\s*(쓰레기|병신| inferior|못 믿음|위험)/gi
        ]
    },
    {
        type: '거짓·기만',
        patterns: [
            /사칭|허위|가짜|거짓|속여|사기|impersonat|fake|pretend/i,
            /(다른 사람|남의|대신)\s*(이름|명의|메일)/i,
            /(교사|선생님|친구)인 척/i
        ]
    },
    {
        type: '탈옥·우회',
        patterns: [
            /(이전|모든|그\s*전)\s*(규칙|명령|지시).*(무시|무효|취소|ignore)/i,
            /(role.?play|DAN|do\s*anything\s*now|jailbreak)/i,
            /(제한|가드레일|보호|필터).*(풀어|해제|없애|제거|bypass|off)/i,
            /(너는|당신은)\s*(제한|한계|규칙).*(없[어다]|자유|free)/i
        ]
    }
];

// =============================================================
//  FILTER FUNCTION — Rule 6
// =============================================================

/**
 * 사용자 입력에 대해 4가지 콘텐츠 필터 검증
 * @param {string} input - 사용자 입력
 * @returns {{ blocked: boolean, type?: string, reason?: string }}
 */
function checkContentFilter(input) {
    for (const filter of CONTENT_FILTERS) {
        for (const pattern of filter.patterns) {
            if (pattern.test(input)) {
                return {
                    blocked: true,
                    type: filter.type,
                    reason: `입력 내용에 '${filter.type}' 관련 표현이 포함되어 있습니다.`
                };
            }
        }
    }
    return { blocked: false };
}

// =============================================================
//  TOOL VALIDATORS — Rule 1, 2
// =============================================================

/**
 * 도구 이름이 ALLOWED_TOOLS에 포함되는지 검증 (Rule 1)
 * @param {string} toolName
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateTool(toolName) {
    if (!ALLOWED_TOOLS.includes(toolName)) {
        return {
            allowed: false,
            reason: `'${toolName}'은(는) 사용할 수 없는 도구입니다. (가능: ${ALLOWED_TOOLS.join(', ')})`
        };
    }
    return { allowed: true };
}

/**
 * 수신자 이메일이 친구 화이트리스트에 있는지 검증 (Rule 2)
 * @param {string} email
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateRecipient(email) {
    const trimmed = email.trim().toLowerCase();
    if (!FRIEND_EMAILS.includes(trimmed)) {
        return {
            allowed: false,
            reason: `'${email}'은(는) 친구 메일 주소가 아닙니다. 발송이 거부되었습니다.`
        };
    }
    return { allowed: true };
}

// =============================================================
//  RETRY STATE — Rule 4, 5
// =============================================================

const retryState = {
    count: 0,
    lastError: null,
    toolName: null,
    params: null,
    failed: false
};

/**
 * retryState 초기화
 */
function resetRetryState() {
    retryState.count = 0;
    retryState.lastError = null;
    retryState.toolName = null;
    retryState.params = null;
    retryState.failed = false;
}

/**
 * retryState 업데이트 (새 도구 호출 시 리셋)
 * @param {string} toolName
 * @param {*} params
 */
function initRetryState(toolName, params) {
    if (retryState.toolName !== toolName ||
        JSON.stringify(retryState.params) !== JSON.stringify(params)) {
        retryState.count = 0;
        retryState.lastError = null;
        retryState.failed = false;
        retryState.toolName = toolName;
        retryState.params = params;
    }
}

// =============================================================
//  3 TOOLS — composeMail, showPreview, sendMail
// =============================================================

/**
 * 1. composeMail — 메일 내용을 채팅에 쓰기 (auto)
 * @param {string} to - 받는 사람
 * @param {string} subject - 제목
 * @param {string} body - 본문
 * @returns {{ success: boolean, draft: { to, subject, body }, error?: string }}
 */
function composeMail(to, subject, body) {
    // 기본 검증
    if (!to || !to.trim()) {
        return { success: false, error: '받는 사람 정보가 없습니다.' };
    }
    if (!subject || !subject.trim()) {
        return { success: false, error: '메일 제목이 없습니다.' };
    }
    if (!body || !body.trim()) {
        return { success: false, error: '본문 내용이 없습니다.' };
    }

    const draft = {
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim()
    };

    return { success: true, draft: draft };
}

/**
 * 2. showPreview — 보내기 전 미리보기 카드 제공 (auto)
 * @param {object} draft - { to, subject, body }
 * @returns {{ success: boolean, html: string, draft: object, error?: string }}
 */
function showPreview(draft) {
    if (!draft || !draft.to || !draft.subject || !draft.body) {
        return { success: false, error: '미리보기할 메일 정보가 부족합니다.' };
    }

    const html = `<div class="email-preview">
        <div class="field"><span class="label">받는 사람</span><span class="value">${draft.to}</span></div>
        <div class="field"><span class="label">제목</span><span class="value">${draft.subject}</span></div>
        <hr class="divider">
        <div class="body-text">${draft.body.replace(/\n/g, '<br>')}</div>
    </div>
    <div class="confirm-row">
        <button class="btn-confirm" data-action="confirm">✅ 확인</button>
        <button class="btn-cancel" data-action="cancel">❌ 취소</button>
    </div>`;

    return { success: true, html: html, draft: draft };
}

/**
 * 3. sendMail — 실제 메일을 보내지 않고 Mock 결과 표시 (ask)
 *    (Rule 2: 수신자 화이트리스트 검증, Rule 3: showPreview 게이트 필수)
 *    메일 읽기·삭제 기능 없음 (write-only)
 * @param {object} draft - { to, subject, body }
 * @returns {{ success: boolean, result?: object, error?: string }}
 */
function sendMail(draft) {
    // Rule 2: 수신자 화이트리스트 검증
    const recipientCheck = validateRecipient(draft.to);
    if (!recipientCheck.allowed) {
        return { success: false, error: recipientCheck.reason };
    }

    // Rule 5: 결과를 절대 지어내지 않음 — 실제 검증 수행
    if (!draft || !draft.to || !draft.subject || !draft.body) {
        return { success: false, error: '메일 정보가 불완전하여 발송할 수 없습니다.' };
    }

    // Mock 발송 처리 (실제 발송 X)
    const result = {
        status: 'success',
        message: '메일이 성공적으로 발송되었습니다. (Mock)',
        to: draft.to,
        subject: draft.subject,
        sentAt: new Date().toISOString(),
        messageId: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
    };

    return { success: true, result: result };
}

// =============================================================
//  TOOL EXECUTION WRAPPER — Rule 4, 5
// =============================================================

/**
 * 도구 호출을 래핑하여 가드레일 적용 + 재시도 로직 포함
 * @param {string} toolName - 호출할 도구 이름
 * @param {Array} args - 도구 파라미터 배열
 * @param {function} addTaoEntry - TAO 로깅 함수 (app.js에서 주입)
 * @param {function} onUserDecision - 사용자 결정 콜백 (app.js에서 주입)
 * @returns {{ success: boolean, data?: any, error?: string, needsDecision?: boolean }}
 */
function executeToolSafely(toolName, args, addTaoEntry, onUserDecision) {
    // Rule 1: 도구 허용 목록 검증
    const toolCheck = validateTool(toolName);
    if (!toolCheck.allowed) {
        return { success: false, error: toolCheck.reason };
    }

    // 재시도 상태 초기화
    initRetryState(toolName, args);

    // 실행 시도 루프
    while (retryState.count < MAX_RETRIES) {
        retryState.count++;
        retryState.lastError = null;

        let result;

        try {
            switch (toolName) {
                case 'composeMail':
                    result = composeMail(args[0], args[1], args[2]);
                    break;
                case 'showPreview':
                    result = showPreview(args[0]);
                    break;
                case 'sendMail':
                    result = sendMail(args[0]);
                    break;
                default:
                    return { success: false, error: `알 수 없는 도구: ${toolName}` };
            }
        } catch (e) {
            result = { success: false, error: e.message || '알 수 없는 오류' };
        }

        // 성공
        if (result.success) {
            resetRetryState();
            return { success: true, data: result };
        }

        // 실패 — 오류 기록
        retryState.lastError = result.error || '원인 불명';

        // 재시도 가능 여부
        if (retryState.count < MAX_RETRIES) {
            addTaoEntry('thought',
                `${toolName} ${retryState.count}회 실패 (${retryState.lastError}). 재시도합니다... (${MAX_RETRIES - retryState.count}회 남음)`,
                null);
            addTaoEntry('observation', `재시도 ${retryState.count}/${MAX_RETRIES}`, null);
        } else {
            // Rule 4: 5회 초과 — 사용자에게 결정 요청
            retryState.failed = true;
            addTaoEntry('thought',
                `${toolName} ${MAX_RETRIES}회 연속 실패. 결과를 지어내지 않고 사용자에게 보고합니다.`,
                null);
            addTaoEntry('observation',
                `⚠️ '${toolName}' ${MAX_RETRIES}회 연속 실패 (마지막 오류: ${retryState.lastError})`,
                null);

            // Rule 5: 절대 결과 지어내지 않음 — 실패 사실 그대로 반환
            return {
                success: false,
                error: retryState.lastError,
                needsDecision: true,
                toolName: toolName,
                retryCount: MAX_RETRIES
            };
        }
    }

    // 이론상 도달하지 않음
    return { success: false, error: '알 수 없는 오류' };
}

// =============================================================
//  EXPOSE GLOBALLY (for app.js)
// =============================================================

window.__tools = {
    ALLOWED_TOOLS,
    TOOL_GRADE,
    FRIEND_EMAILS,
    MAX_RETRIES,
    CONTENT_FILTERS,
    checkContentFilter,
    validateTool,
    validateRecipient,
    executeToolSafely,
    composeMail,
    showPreview,
    sendMail,
    resetRetryState,
    retryState
};
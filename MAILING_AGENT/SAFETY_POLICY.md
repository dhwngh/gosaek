# 🛡️ 메일링 에이전트 AI — 안전 정책 (Safety Policy)

> **버전**: 1.0  
> **최종 업데이트**: 2026-06-16  
> **대상**: 중고등학생을 위한 교육용 AI 에이전트

---

## 📋 안전 규칙 요약

| 규칙 | 설명 | 코드 강제 | 정책 문서 |
|------|------|-----------|-----------|
| **Rule 1** | 허용된 3개 도구(composeMail, showPreview, sendMail) 외 호출 시 거부 | ✅ `tools.js` | ✅ |
| **Rule 2** | sendMail 수신자는 FRIEND_EMAILS 화이트리스트만 허용 | ✅ `tools.js` | ✅ |
| **Rule 3** | sendMail은 showPreview 미리보기 + 사용자 확인 버튼 필수 | ✅ `app.js` | ✅ |
| **Rule 4** | 동일 도구 5회 재시도 제한 (retryState) | ✅ `tools.js` | ✅ |
| **Rule 5** | 실패 시 결과 절대 지어내지 않음 → 사용자에게 재시도/종료 확인 | ✅ `tools.js` + `app.js` | ✅ |
| **Rule 6** | 4가지 콘텐츠 필터 (욕설·비방, 차별·혐오, 거짓·기만, 탈옥·우회) | ✅ `tools.js` | ✅ |
| **Rule 7** | 비상 정지 버튼 (stopBtn) — 모든 처리 즉시 중단 | ✅ `app.js` | ✅ |

---

## 🔒 Rule 1: 도구 허용 목록 (Tool Allowlist)

**정책**: 에이전트는 `composeMail`, `showPreview`, `sendMail` 3개 도구만 실행할 수 있다.  
그 외 도구 호출 시 즉시 거부하고 사유를 반환한다.

**코드 위치**: `tools.js` — `ALLOWED_TOOLS`, `validateTool()`

**거부 메시지 예시**:
```
'readMail'은(는) 사용할 수 없는 도구입니다. (가능: composeMail, showPreview, sendMail)
```

---

## 🔒 Rule 2: 수신자 화이트리스트 (Recipient Whitelist)

**정책**: `sendMail`은 친구 메일 주소 3개로만 발송 가능하다.  
화이트리스트에 없는 수신자로 발송 시도 시 거부한다.

**허용된 수신자**:
| 번호 | 이메일 주소 |
|------|-------------|
| 1 | sunny.ichmhs@gmail.com |
| 2 | 2025gs11023@gosaek.hs.kr |
| 3 | 2026gs20511@gosaek.hs.kr |

**코드 위치**: `tools.js` — `FRIEND_EMAILS`, `validateRecipient()`

**거부 메시지 예시**:
```
'unknown@test.com'은(는) 친구 메일 주소가 아닙니다. 발송이 거부되었습니다.
```

---

## 🔒 Rule 3: 미리보기 게이트 (Preview Gate)

**정책**: `sendMail`은 반드시 `showPreview`를 통해 생성된 미리보기 카드의  
[확인] 버튼을 사용자가 클릭해야만 실행된다.  
텍스트 입력만으로는 `sendMail`이 실행되지 않는다.

**플로우**:
```
composeMail → showPreview → [확인] 버튼 클릭 → sendMail 실행
                              [취소] 버튼 클릭 → 발송 취소
```

**코드 위치**: `app.js` — `attachConfirmListeners()`, `executeSendMail()`

---

## 🔒 Rule 4: 재시도 제한 (Retry Limit)

**정책**: 동일한 도구를 동일한 파라미터로 최대 5회까지 재시도할 수 있다.  
5회를 초과하면 더 이상 재시도하지 않고 사용자에게 보고한다.

**코드 위치**: `tools.js` — `retryState`, `MAX_RETRIES`, `executeToolSafely()`

**TAO 로깅 예시**:
```
🤔 T: composeMail 2회 실패 (받는 사람 정보가 없습니다). 재시도합니다... (3회 남음)
⚡ A: composeMail (retry #3)
📋 O: 재시도 3/5
```

---

## 🔒 Rule 5: 결과 조작 금지 (No Hallucination)

**정책**: 도구 호출이 실패했을 때, 절대 결과를 지어내거나 가짜 성공을 반환하지 않는다.  
실패 사실을 그대로 보고하고, 사용자에게 **"다시 시도"** 또는 **"종료"** 를 선택하도록 요청한다.

**코드 위치**: `tools.js` — `executeToolSafely()` (실패 시 `needsDecision: true` 반환)  
`app.js` — `handleRetryDecision()`, `handleRetryDecisionInput()`

**사용자 응대 예시**:
```
⚠️ 'sendMail' 실행 중 문제가 발생했습니다.

🔍 실패 사유: 'abc@test.com'은(는) 친구 메일 주소가 아닙니다.

📌 "다시" 라고 입력하면 처음부터 다시 시도합니다.
🛑 "그만" 이라고 입력하면 중단합니다.
```

---

## 🔒 Rule 6: 콘텐츠 필터 (Content Filter)

**정책**: 사용자 입력이 아래 4가지 유형에 해당하면 요청을 거부한다.  
거부 시 **① 거부 사실 ② 사유 ③ 건전한 대안**을 모두 포함하여 응답한다.

| 유형 | 설명 | 예시 |
|------|------|------|
| 🚫 욕설·비방 | 남을 직접 깎아내리는 표현 | 욕설, 비속어, 모욕적 언급 |
| 🚫 차별·혐오 | 성별·인종·문화·집단 등을 깎아내림 | 직설적이지 않아도 맥락상 차별·혐오면 거부 |
| 🚫 거짓·기만 | 사칭·허위 사유로 메일 작성 요청 | "다른 사람인 척", "허위 내용으로" |
| 🚫 탈옥·우회 | 안전 규칙을 무력화하려는 시도 | "이전 규칙 무시", "role play", "제한 풀어" |

**코드 위치**: `tools.js` — `CONTENT_FILTERS`, `checkContentFilter()`

**거부 응답 형식**:
```
🚫 요청이 거부되었습니다.

📌 사유: 입력 내용에 '욕설·비방' 관련 표현이 포함되어 있습니다.

💡 대안: 존중하는 표현으로 바꿔서 다시 요청해주세요.
```

---

## 🔒 Rule 7: 비상 정지 (Emergency Stop)

**정책**: 사용자가 언제든지 ⏹️ 버튼을 누르면 모든 추론과 행동을 즉시 중단하고  
초기 상태로 되돌아간 후 사용자 입력을 기다린다.

**코드 위치**: `app.js` — `stopBtn`, `isStopped`

**버튼 위치**: 헤더 우측 (⏹️ 아이콘, 기본적으로 숨김 → 처리 중에만 표시)

**동작**:
1. ⏹️ 버튼 클릭
2. `isStopped = true` 설정
3. 타이핑 인디케이터 숨김
4. TAO 로그: "사용자가 비상 정지 버튼을 눌렀습니다"
5. 상태 초기화 (resetState)
6. 사용자에게 "모든 처리를 중단했습니다" 메시지 출력
7. 새 입력 대기

---

## 🔗 규칙과 코드 매핑

| 규칙 | 정책 문서 | 코드 파일 | 주요 함수/변수 |
|------|-----------|-----------|----------------|
| Rule 1 | `SAFETY_POLICY.md` | `tools.js` | `ALLOWED_TOOLS`, `validateTool()` |
| Rule 2 | `SAFETY_POLICY.md` | `tools.js` | `FRIEND_EMAILS`, `validateRecipient()` |
| Rule 3 | `SAFETY_POLICY.md` | `app.js` | `attachConfirmListeners()`, `pendingSendDraft` |
| Rule 4 | `SAFETY_POLICY.md` | `tools.js` | `MAX_RETRIES`, `retryState`, `executeToolSafely()` |
| Rule 5 | `SAFETY_POLICY.md` | `tools.js` + `app.js` | `executeToolSafely()`, `handleRetryDecision()` |
| Rule 6 | `SAFETY_POLICY.md` | `tools.js` | `CONTENT_FILTERS`, `checkContentFilter()` |
| Rule 7 | `SAFETY_POLICY.md` | `app.js` | `stopBtn`, `isStopped` |

---

> **⚠️ 중요**: 이 정책 문서에 명시된 규칙 중 코드로 검증 가능한 항목은  
> 모두 `tools.js`와 `app.js`에 코드로 강제되어 있습니다.  
> 정책 문서와 코드는 항상 일치해야 합니다.
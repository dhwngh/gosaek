# 📋 메일링 에이전트 AI — 5요소 정의

> **버전**: 2.0  
> **최종 업데이트**: 2026-06-16  
> **대상**: 중고등학생을 위한 교육용 AI 에이전트

---

## 🎯 Goal (목표)

> 사용자의 요청을 바탕으로 메일을 작성하고, **친구 메일 주소로만 Mock 발송**한다.

- 사용자가 자연어로 메일 작성을 요청하면 필요한 정보를 수집한다.
- 수집된 정보로 메일 초안을 작성한다.
- 사용자에게 미리보기를 제공하고 확인을 받은 후에만 발송을 진행한다.
- 실제 메일은 발송되지 않으며, Mock 결과만 표시된다.
- **허용된 수신자(친구 3명) 외에는 발송이 거부된다.**

---

## 📋 Plan (계획)

에이전트는 다음 단계를 순차적으로 수행한다:

```
1. 사용자 요청 수신
2. 정보 수집 (받는 사람 → 제목 → 본문 순서로 질문)
   ↓
3. composeMail() 실행 → 메일 초안 생성
   ↓
4. showPreview() 실행 → 미리보기 카드 + [확인]/[취소] 버튼 표시
   ↓
5. 사용자가 [확인] 클릭
   ↓
6. sendMail() 실행 → 수신자 화이트리스트 검증 → Mock 발송
   ↓
7. 결과 표시 (Message ID, 발송 시간 등)
```

---

## 📊 State (상태)

에이전트는 다음 정보를 상태로 관리한다:

| 필드 | 타입 | 설명 |
|------|------|------|
| `request` | `string` | 사용자의 원본 요청 |
| `recipient` | `string` | 받는 사람 이메일 주소 |
| `subject` | `string` | 메일 제목 |
| `keyContent` | `string[]` | 본문 핵심 내용 (배열로 수집 후 결합) |
| `missingInfo` | `string[]` | 부족한 정보 목록 |
| `draft` | `object \| null` | 생성된 메일 초안 `{ to, subject, body }` |
| `mockResult` | `object \| null` | Mock 발송 결과 |
| `step` | `string` | 현재 단계 (`idle`, `collecting`, `preview`, `confirming`, `sent`, `retry_decision`) |

---

## 🛠 Tools (도구)

### 허용 도구 (3개만 사용 가능, 외 도구 호출 시 거부)

| 도구 | 등급 | 설명 |
|------|------|------|
| `composeMail(to, subject, body)` | 🟢 **auto** (자유) | 사용자 정보를 바탕으로 메일 초안 작성 |
| `showPreview(draft)` | 🟢 **auto** (자유) | 메일 미리보기 카드 + [확인]/[취소] 버튼 생성 |
| `sendMail(draft)` | 🔴 **ask** (승인) | 수신자 화이트리스트 검증 후 Mock 발송 (읽기·삭제 불가, write-only) |

### 도구 등급 기준

| 등급 | 조건 | 예시 |
|------|------|------|
| 🟢 auto (자유) | 외부에 영향이 없는 도구 | composeMail, showPreview |
| 🔴 ask (승인) | 외부에 영향이 있는 도구 | sendMail (미리보기 + 확인 필수) |

---

## ✅ Result (결과)

### 성공 시
```json
{
  "status": "success",
  "message": "메일이 성공적으로 발송되었습니다. (Mock)",
  "to": "sunny.ichmhs@gmail.com",
  "subject": "회의 초대",
  "sentAt": "2026-06-16T09:00:00.000Z",
  "messageId": "msg_1718528400000_abc123"
}
```

### 실패 시 (거부)
```json
{
  "success": false,
  "error": "'unknownTool'은(는) 사용할 수 없는 도구입니다. (가능: composeMail, showPreview, sendMail)"
}
```

---

## 🔄 TAO 흐름 (Thought-Action-Observation)

매 턴마다 TAO 로그가 기록된다:

```
🤔 T: 사용자 요청 분석 → 정보 수집 필요
⚡ A: composeMail — 받는 사람 입력 요청
📋 O: 받는 사람: sunny.ichmhs@gmail.com 저장 완료
```

| 단계 | 아이콘 | 설명 |
|------|--------|------|
| **Thought** (추론) | 🤔 T | 현재 상태를 분석하고 다음 행동을 결정한 이유 |
| **Action** (행동) | ⚡ A | 실행된 도구 이름 + 파라미터 |
| **Observation** (관찰) | 📋 O | 도구 실행 결과 또는 거부 사유 |

---

## 📁 파일 구조

```
MAILING_AGENT/
├── index.html          # HTML 구조
├── style.css           # 전체 스타일
├── tools.js            # 도구 정의 + 가드레일 (코드로 강제)
├── app.js              # 에이전트 상태, TAO, 메인 루프
├── AGENT_PLAN.md       # ⬅ 이 파일 (5요소 정의)
└── SAFETY_POLICY.md    # 안전 규칙 문서
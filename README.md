# Char Highlighter

Obsidian 에디터(Live Preview / Source)에서 특정 문자/단어를 감지해 하이라이트하고, 필요하면 자동 치환까지 수행하는 플러그인입니다.

## 주요 기능

- Live Preview / Source 모드에서 CodeMirror 6 데코레이션 하이라이트
- 패턴별 색상 지정
- 일반 문자열 또는 정규식 패턴 지원
- 패턴별 자동 치환(Auto Replace) 지원
- 잘못된 정규식은 자동 무시 (에러 방지)

## 기본 패턴

초기 설정에는 아래 패턴이 포함됩니다.

- TODO (노랑)
- FIXME (빨강)

## 설치 방법 (수동)

1. Obsidian 볼트의 플러그인 폴더를 엽니다.
   - `.obsidian/plugins/char-highlighter/`
2. 이 저장소의 파일을 해당 폴더에 넣습니다.
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. Obsidian에서 Community Plugins를 새로고침 후 플러그인을 활성화합니다.

## 사용 방법

1. Obsidian 설정에서 Char Highlighter 설정 탭을 엽니다.
2. 패턴을 추가/수정합니다.
3. 각 패턴에 대해 아래 항목을 설정합니다.
   - text: 찾을 문자열 또는 정규식
   - enabled: 패턴 사용 여부
   - color: 하이라이트 색상
   - isRegex: 정규식 사용 여부
   - autoReplace: 자동 치환 사용 여부
   - replacement: 치환할 문자열

## 패턴 예시

- 일반 문자열 하이라이트
  - text: TODO
  - isRegex: false

- 정규식 하이라이트
  - text: `\b(ASAP|URGENT)\b`
  - isRegex: true

- 자동 치환
  - text: teh
  - isRegex: false
  - autoReplace: true
  - replacement: the

## 주의사항

- 자동 치환은 문서 변경 시점에 동작합니다.
- IME 조합 중(예: 한글 입력 중)에는 자동 치환이 비활성화되어 입력 꼬임을 방지합니다.
- 패턴이 겹치는 경우 먼저 매칭된 항목이 우선 적용됩니다.

## 라이선스

필요에 따라 LICENSE 파일을 추가해 주세요.

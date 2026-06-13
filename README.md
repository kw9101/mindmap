# Mindmap

Tauri 기반 키보드 중심 마인드맵 프로그램입니다.

현재 단계는 MVP 구현 중입니다. Markdown 파일을 원본 문서로 두고, 앱 전용 상태는 SQLite sidecar에 저장합니다.

## 목표

- 하나의 마인드맵을 하나의 Markdown 파일로 안전하게 저장한다.
- 유효한 마인드맵 파일은 첫 번째 H1과 그 아래 최소 하나의 최상위 목록을 가져야 한다.
- GitHub에서 자연스럽게 읽히는 Markdown 구조를 사용하고, 비표준 확장 문법은 지양한다.
- 배치는 좌표를 저장하지 않고 Markdown 구조에서 예측 가능하게 자동 계산한다.
- 기본 배치는 오른쪽이며, 방향이 필요한 경우 `## Left`와 `## Right` 섹션으로 명시한다.
- 읽기와 저장이 문서를 암묵적으로 바꾸지 않도록 자동 정규화는 하지 않는다.
- Markdown에는 문서 의미와 구조만 저장하고, 앱 상태와 편의 데이터는 SQLite에 저장한다.
- 노드 ID, 좌표, 접힘, 선택, 커서, 노드 크기 같은 앱 전용 정보는 Markdown에 저장하지 않는다.
- 앱 내부 raw Markdown 편집 모드는 제공하지 않고, 원문 편집은 외부 에디터의 역할로 둔다.
- 앱 내부 편집 명령은 항상 유효한 마인드맵 AST를 만든다.
- 자동 저장은 지연 저장으로 처리하고, 외부 변경은 파싱 가능 여부와 dirty 상태에 따라 리로드/진단/충돌 처리한다.
- 읽을 수 없는 Markdown은 조용히 실패하지 않고, 원인과 수정 방법을 자세히 진단한다.
- 자동 복구는 지양하고, 사용자가 명시적으로 고치도록 돕는다.
- 마우스보다 키보드로 빠르게 생각을 구조화하는 편집 경험을 만든다.
- 데스크톱에서 로컬 파일을 직접 열고 저장하는 흐름을 우선한다.
- 키보드 중심 구조 편집을 우선한다.

## 구현된 기능

- [프로젝트 계획서](docs/project_plan.md)
- Markdown mindmap parser/serializer와 진단 코드
- React 기반 자동 배치 마인드맵 편집 화면
- 노드 추가, 수정, 삭제, 형제/자식 이동 및 생성, 형제 순서 이동
- 내용 없는 리프 노드의 임시 상태 시각 표시
- 세션 내 undo/redo
- Tauri command 기반 Markdown 파일 열기/원자적 저장
- 지연 자동 저장
- 외부 변경 file watcher + polling, clean 자동 리로드, invalid 외부 파일 진단, dirty 충돌 처리
- 외부 diff 도구 실행용 임시 파일 생성 및 실행 명령
- 명시적 Markdown 정규화 명령
- SQLite sidecar 기반 view state 저장
- 선택 모드 기반 키보드 이동과 다중 선택
- 선택 모드와 편집 모드의 명확한 시각 구분
- 키바인딩 도움말
- 노드 검색, 결과 이동, match highlight
- 검색 가능한 커맨드 팔렛트
- Markdown subtree 클립보드 복사/잘라내기/붙여넣기
- 캔버스 드래그/버튼 pan, 상태 표시, SQLite view state 저장
- 마우스 드래그 기반 노드 재배치
- 노드 hover 보조 핸들 기반 자식 추가, 형제 추가, 삭제
- 노드 접기/펼치기와 큰 마인드맵용 가로 확장 레이아웃
- Tauri file watcher 장시간 stress test
- 기능별 unit test
- Playwright 기반 e2e user-flow test

## 개발 실행

필요 도구:

- Node.js
- pnpm
- Rust

명령:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test
pnpm e2e
pnpm test:all
pnpm dev -- --port 1420
```

Tauri 확인:

```bash
pnpm test:tauri
pnpm test:tauri:watch
cd src-tauri && cargo check
```

`pnpm test:tauri:watch`는 기본 120회, 250ms 간격으로 반복한다. 짧게 확인하려면
`MINDMAP_WATCH_STRESS_ITERATIONS=5 MINDMAP_WATCH_STRESS_TIMEOUT_MS=3000 MINDMAP_WATCH_STRESS_INTERVAL_MS=0 pnpm test:tauri:watch`처럼 조절한다.

전체 프론트 빌드:

```bash
pnpm build
```

데스크톱 실행:

```bash
pnpm tauri dev
```

## 기본 조작

- 편집 중 `Enter`: 다음 형제 노드로 이동, 없으면 선택 노드 다음에 형제 노드 추가
- 편집 중 `Cmd/Ctrl+Enter`: 선택 노드 바로 아래에 형제 노드 추가
- 편집 중 `Shift+Enter`: 위 형제 노드로 이동, 없으면 선택 노드 위에 형제 노드 추가
- 편집 중 `Tab`: 첫 자식 노드로 이동, 없으면 선택 노드 아래에 자식 노드 추가
- 편집 중 `Shift+Tab`: 부모 노드로 포커스 이동
- 텍스트와 자식이 모두 없는 빈 노드는 반투명 점선으로 표시되고, 포커스를 잃으면 자동 삭제
- 마우스 클릭: 노드 선택
- 선택된 노드 다시 클릭 또는 선택 모드 `Enter`: 선택 노드 편집
- 노드 hover 핸들: 자식 추가, 다음 형제 추가, 삭제
- 선택 모드 `Cmd/Ctrl+Click`: 노드 선택 토글
- 선택 모드 `Shift+Click` 또는 `Shift+Arrow`: 기준 노드부터 대상 노드까지 범위 선택
- 노드 드래그: 대상 노드의 위/아래/가운데로 끌어 앞 형제/뒤 형제/자식으로 재배치
- `Cmd/Ctrl+Arrow`: 선택 노드를 화면상 해당 방향으로 이동. 여러 형제 노드가 선택된 경우 묶음으로 이동. 루트 노드의 좌/우 이동은 반대쪽 가지로 이동
- `Option+Backspace` 또는 `Cmd+Backspace`: 노드 삭제
- `Esc`: 편집 모드에서 선택 모드로 전환. 빈 일반 노드에서는 해당 노드 삭제
- 선택 모드 `ArrowUp` / `ArrowDown`: 화면상 위/아래에 있는 가장 가까운 노드 선택
- 선택 모드 `ArrowLeft` / `ArrowRight`: 화면상 왼쪽/오른쪽으로 한 세대씩 이동
- 선택 모드 `Enter`: 선택 노드 편집
- 선택 모드 `Cmd/Ctrl+Enter`: 선택 노드 바로 아래에 형제 노드 추가
- 선택 모드 `Tab`: 첫 자식 노드 선택, 없으면 자식 노드 생성
- 선택 모드 `Shift+Tab`: 부모 노드 선택
- 선택 모드 `Space`: 선택 노드의 자식 접기/펼치기
- 선택 모드 `Delete` 또는 `Backspace`: 선택 노드 삭제
- 선택 모드 `Cmd/Ctrl+Arrow`: 선택 노드를 화면상 해당 방향으로 이동. 여러 형제 노드가 선택된 경우 묶음으로 이동. 루트 노드의 좌/우 이동은 반대쪽 가지로 이동
- 선택 모드 `Cmd/Ctrl+C`: 선택 subtree를 Markdown 목록으로 복사
- 선택 모드 `Cmd/Ctrl+X`: 선택 subtree를 Markdown 목록으로 복사한 뒤 삭제
- 선택 모드 `Cmd/Ctrl+V`: Markdown 목록 또는 단일 텍스트를 선택 노드 다음에 붙여넣기
- `Search` 또는 `Cmd/Ctrl+F`: 노드 텍스트 검색, `Enter` 다음 결과, `Shift+Enter` 이전 결과
- `Cmd/Ctrl+K` 또는 `Cmd/Ctrl+Shift+P`: 커맨드 팔렛트 열기
- 빈 캔버스 드래그: 화면 pan
- 마우스 휠: 화면 확대/축소
- pan 화살표: 화면 위치를 8px 단위로 조정
- `Center`: pan 위치 초기화
- `Cmd+Z`: undo
- `Cmd+Shift+Z` 또는 `Cmd+Y`: redo
- `Cmd+S`: 저장 또는 다른 이름 저장
- `Cmd+O`: Markdown 파일 열기
- `Normalize`: CRLF, 마지막 개행, heading/blank trailing spaces, 빈 노드 marker 같은 명확한 파일 형식 문제를 명시적으로 정규화
- `?` 또는 `Cmd/Ctrl+/`: 키바인딩 도움말

## 다음 행동

1. 다음 planning pass에서 새 기능 후보를 정한다.

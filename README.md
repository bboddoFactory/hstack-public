# hstack

hstack의 h는 hippo다. 에이전트와 함께 프로젝트를 만들며 일하는 방식을 익히고 기록하려는 사람을 위한 도구다. Claude Code 플러그인이면서, 그 플러그인을 배포하는 마켓이기도 하다. Lauren Tan의 [pstack](https://github.com/cursor/plugins/tree/main/pstack)(MIT)에서 영감을 받아 만들었다. basics의 「pstack 원칙(들)」은 pstack의 원칙을, `how-we-work.md`의 일하는 순서는 pstack `poteto-mode`의 절차서를 우리 말로 다시 정리한 것이다.

## 새 PC에 설치하기

현재 버전은 `.claude-plugin/plugin.json`에 있다.

1. 저장소를 `~/workspace/hstack`에 받는다. Hstack이 작업 기록을 여기(`data/`)에 쌓기 때문에 위치를 지킨다. 공개 저장소에는 `data/`가 없고 `.gitignore`가 `data/`를 막는다. 그 PC의 기록은 그 PC에만 쌓인다.

   ```bash
   git clone https://github.com/bboddoFactory/hstack-public.git ~/workspace/hstack
   ```

2. 마켓을 추가하고 플러그인을 설치한다.

   ```bash
   claude plugin marketplace add bboddoFactory/hstack-public
   ```

   ```bash
   claude plugin install hstack@hstack
   ```

3. 전역 `~/.claude/CLAUDE.md` 끝에 아래 두 줄을 더한다. 항상 깔리는 것(`basics.md`)이 모든 세션에 들어온다. 세션이 시작될 때 한 번 읽으므로, `basics.md`를 고치면 다음 세션부터 적용된다.

   ```
   ## 항상 깔리는 것 (hstack)
   @~/workspace/hstack/basics.md
   ```

4. 설치본 갱신 후 새 세션을 열어 `/hstack:hippo-mode`의 인식을 확인한다. 원본 변경만으로 기존 설치본이나 열린 세션이 갱신됐다고 보지 않는다.

5. Codex를 쓰는 PC라면 아래 「Codex 설정」대로 반영 스크립트를 돌린 뒤 Codex를 대화형으로 한 번 열어 상기형 훅을 승인한다. **승인하지 않으면 경고 없이 실행되지 않는다.** 새 세션에서 맥락에 `[hstack 상기]` 글이 있는지 물어 확인한다. Claude Code는 플러그인 설치본의 `hooks/hooks.json`으로 훅이 붙는다.

pstack은 hstack에 들어 있지 않다. 남이 만든 것이라 따로 설치한다. 원본은 [cursor/plugins의 pstack](https://github.com/cursor/plugins/tree/main/pstack)이다. `pstack-guide`는 pstack이 설치되어 있어야 쓸모가 있다.

### Codex 설정

저장소를 받은 뒤 로컬 마켓을 등록하고 플러그인을 설치한다. 기존 `.claude-plugin/` 정의를 그대로 사용한다.

```sh
codex plugin marketplace add "$HOME/workspace/hstack" --json
codex plugin add hstack@hstack --json
codex plugin list --json
```

설치·갱신 뒤 새 Codex 세션에서 hstack 스킬이 목록에 보이는지 확인한다. 스킬 인식과 각 스킬의 실제 실행은 따로 확인한다.

원본을 고친 뒤에는 `codex plugin add hstack@hstack --json`을 다시 실행하고 목록의 설치 버전을 확인한다. 로컬 마켓은 이 저장소를 직접 참조한다. 이미 열린 세션에는 새 내용이 반영됐다고 가정하지 않는다.

공통 본문은 저장소 폴더에서 다음 명령으로 전역 지침에 반영한다. Python 3 표준 라이브러리만 사용한다.

```sh
python3 scripts/sync-codex-basics.py
python3 scripts/sync-codex-basics.py --check
```

스크립트는 공통 본문과 상기형 훅을 반영한다. 다시 실행해도 같은 결과가 되며 `--check`는 파일을 바꾸지 않고 불일치하면 종료 코드 1을 반환한다. 설치·전역 본문 일치·실제 실행은 각각 확인한다.

### 독립 검토를 위한 CLI 준비

난도별 모델·호출 방법과 결과 확인 절차는 [에이전트 호출 방법](docs/agent-calls.md)에 있다.

- 새 PC에서는 각 CLI의 정상 로그인 절차를 사용자가 완료한 뒤 모델 접근 여부를 확인한다. API 키가 설정된 환경은 구독 인증과 과금 경로가 다를 수 있으므로 현재 인증 방식을 확인하고, 로그인이나 결제 설정을 몰래 바꾸지 않는다.
- 설치·인증·모델 접근·실제 검토 성공은 서로 구분해 확인한다.

## 히포 모드와 스토리맵 보드 쓰기

프로젝트 폴더에서 세션을 열고 `/hstack:hippo-mode`를 부른다. 기록이 처음이면 프로젝트의 목적과 기록 이름을 확인하고 필요한 최소 기록부터 만든다. 현재 작업이 분명하면 필요한 Understand·Design 같은 단계로 바로 이어 갈 수도 있다.

흐름: 제품의 목적·사용자 행동 확인 → 후보 작업 → 같은 작업의 범위·명세 구체화 → 필요한 이해·설계·구현·검증 → 완료 또는 취소. 카드 하나가 작업 하나이며 별도 에픽 승격이나 새 핸드오프 문서를 만들지 않는다. 보드는 가로에 사용자 행동, 세로에 후보·진행 중·완료·취소를 보여 준다. 보드는 상태·위치·파일 연결을, 작업 파일은 현재 명세·완료 기준·적용할 상세 자료·결과를 관리한다. [기록 책임과 읽는 순서](docs/work-records.md)가 공통 원본이다.

남는 것은 전부 `data/story-map/<프로젝트>/`에 있다. 스토리 맵 산출물뿐 아니라 설계, 결정, 일지도 여기 둔다. 프로젝트 저장소에는 코드만 둔다.

| 파일 | 담는 것 |
|---|---|
| `product.md` | 공통 제품 목적·원칙·현재 지원 범위와 제한. 머리말 `summary`가 현황판 제목 아래에 보인다 |
| `project-guide.md` | 다음 작업에도 적용할 개인 기준과 조건·근거. 기준이 생길 때 만들며 읽기·전달·갱신은 프로젝트 기준 관리 절차를 따른다 |
| `tasks/<작업 이름>/작업.md` | 메인이 관리하는 현재 합의·짧은 선택 이유와 근거·확인 결과·남은 일. 요청서·하위 에이전트 보고서·관련 자료는 같은 폴더에 둔다 |
| `tasks/<작업 이름>/log.md` | 결정 이유·변경 경과·시도와 실패·사용자 지적·미결 논의·재개 지점. 기록할 일이 생기면 메인이 만들고 덧붙인다 |
| `board.json` | `format: task-board`, 사용자 행동·작업 카드·상태·작업 파일 경로 |
| `log.md` | 프로젝트 성장의 요약. 작업 결과·확인 범위·제한과 작업 파일·작업 로그 링크를 목록으로 남긴다. 프로젝트 전체의 중요한 결정도 요약한다 |

그림 선택·핵심 해설과 채팅 설명은 [브라우저 설명 스킬](skills/browser-explain/SKILL.md)을 따른다. 메인의 저장·HTTP 제공·주소 전달은 [브라우저 설명 자료 절차](how-we-work.md#브라우저로-이해설계-자료를-보여-주는-방법)를 따른다.

현황판 띄우기:

```bash
~/workspace/hstack/skills/story-map/scripts/serve.sh
```

출력된 주소(`http://<주소>:5180/skills/story-map/board/?p=<프로젝트>`)로 연다. Tailscale이 있으면 다른 기기에서도 열린다. 새 보드의 작업 카드를 누르면 현재 작업 파일과 근거 링크를 읽는다. 완료 행은 작업 이력이며 현재 제품의 모든 기능을 보장하지 않는다.

## 스킬 목록

| 무엇 | 부르는 법 | 언제 쓰나 |
|---|---|---|
| 히포 모드 | `/hstack:hippo-mode` | 요청을 작업으로 정리하고 필요한 단계로 이어 갈 때. 현재 기록과 사용자 행동별 스토리맵 보드를 관리한다 |
| 시제품 스킬 | `/hstack:prototype` | 방향을 모를 때. 버리는 시제품을 만들어 써 보고 정한다 |
| 현재 구조 이해 스킬 | `/hstack:understand` | 질문에 필요한 동작·책임·데이터 흐름과 선택 배경을 조사하고 브라우저로 함께 이해한다 |
| 변경 설계 스킬 | `/hstack:design` | 메인과 두 설계자의 후보를 별도 적대 검토하고, 구조와 중요한 선택을 사용자와 정한다 |
| 구현 준비 스킬 | `/hstack:prepare` | 목적과 완료 기준이 정해진 뒤. 필요한 Understand↔Design을 연결하고 확정 결정·남은 질문을 얇은 레이어 표로 정리한다 |
| 레이어 스킬 | `/hstack:layer` | 레이어마다. 명세·이번 구성·검증 계획 함께 확인 → 메인의 행동 테스트·확인 준비 → 구현 위임 → 메인이 동작·구성을 대조 → 올리고 사용자 확인 |
| 리뷰 스킬 | `/hstack:review` | 마지막 레이어 뒤. 두 새 세션이 동작·구조·테스트를 독립 검토하고 지정한 시험 환경에서 재현한다. 메인이 근거를 대조하고 사용자와 고칠 범위를 정해 리뷰 레이어로 수정·확인한 뒤 닫는다 |
| 브리핑 스킬 | `/hstack:brief` | 오랜만에 돌아왔을 때. 프로젝트 요약·현황판·현재 작업 파일과 작업 로그를 읽고 지금 어디, 열려 있는 일, 다음에 할 한 가지를 말한다 |
| 돌아보기 스킬 | `/hstack:retro` | 필요할 때 현재 세션의 실제 요청·응답·실행을 돌아본다. Hstack 지침과 비교해 개선안을 제안하고 승인한 변경만 반영한다 |
| 규칙 적용 스킬 | `/hstack:migrate` | 바뀐 규칙을 지정한 프로젝트 범위의 기록에 적용할 때. 지정이 없으면 현재 대화의 프로젝트를 확인한다. 출시 버전의 적용 항목과 필요한 변경안을 확인받아 반영하고 `hstack-version`을 갱신한다 |
| pstack 길잡이 | `/hstack:pstack-guide` | pstack 스킬 중 무엇을 언제 쓰는지 모를 때 |
| 화면 디자인 설명서 | `/hstack:ui-design` | 화면의 색·글자·배치·컴포넌트를 정하거나 바꿀 때. 무엇을 비교판으로 묻고 무엇을 원칙으로 정하나, 기본 점검표로 모르는 것을 먼저 꺼낸다. 프로젝트별 값은 `data/story-map/<프로젝트>/DESIGN.md` |
| 브라우저 설명 스킬 | `/hstack:browser-explain` | 질문에 맞는 그림을 고르고 그림 이름·뜻·선택 이유를 페이지 제목 아래에 쓴 뒤, 브라우저의 그림·핵심 해설과 채팅의 상세 설명으로 함께 이해하고 판단할 때 |
| Codex 자동화 스킬 | `/hstack:codex-automation` | Codex 예약 실행을 만들거나 고치고, 중지·삭제·점검할 때 |
| 허더 스킬 | `/hstack:herdr` 또는 자연어 요청 | 음성 입력의 표기 차이를 문맥으로 이해하고, 화면 위치로 HERDR 패널을 찾아 확인하거나 요청한 조작을 할 때 |

hstack을 고치거나 구조를 보려면 `/hstack:hstack-guide`를 부른다.

## 라이선스

MIT. [LICENSE](LICENSE)를 본다. pstack에서 가져와 다시 정리한 부분의 원본도 MIT이며 저작권은 Lauren Tan에게 있다.

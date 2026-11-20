# 에이전트 호출 방법

이 문서는 메인이 Claude Code 또는 Codex일 때 조사자·독립 검토자·구현자를 어떻게 부르고, 막혔을 때 무엇으로 대체하는지 정한다. 공통 판단 원칙은 `../basics.md`에 둔다. 모델 계열과 강도는 아래 역할표 한 곳에서 바꾼다.

## 위임은 CLI 헤드리스 호출로 한다

메인이 Claude Code든 Codex든 조사자·설계자·검토자·구현자는 모두 새 CLI 헤드리스 세션(`claude -p`, `codex exec`)으로 부른다. 도구 안의 서브에이전트나 플러그인 에이전트 정의를 쓰지 않는다. 호출마다 모델과 강도를 명시하고, 실행 정보(JSON)로 실제 모델과 오류를 확인하며, 어느 메인에서든 같은 명령을 쓴다. 명령 모양은 아래 「CLI 호출 예시」와 「구현자 호출」에 있다.

## 모델은 계열로 부른다

역할표는 Opus, Sonnet, Haiku, Sol, Astra, Terra, Luna처럼 계열과 강도만 적는다. 부를 때 그 계열의 가장 높은 판을 쓰며, 새 판이 나와도 이 문서를 고치지 않는다.

- Claude는 계열 별칭(`opus`, `sonnet`, `haiku`)으로 부른다.
- Codex는 `~/workspace/hstack/scripts/codex-model.sh <계열>`이 Codex 모델 목록에서 고른 이름으로 부른다. 스크립트가 실패하면 아래 대체 표를 따른다.
- 보고에는 실행 정보에서 확인한 실제 모델 ID를 남긴다.
- 특정 판을 쓰지 않아야 하면 그 예외만 역할표에 적는다. 계열을 바꾸는 것은 역할 배정을 바꾸는 것이므로 역할표를 고친다.

## 역할표

### 구현자 (레이어 구현, 버리는 시제품)

| | 모델·강도와 호출 |
|---|---|
| **기본** | Terra **high**, `codex exec` 쓰기 가능 |
| **막히면** | → Claude Sonnet **high**, `claude -p --model sonnet --effort high` |
| **설명 페이지 제작** | Claude Sonnet **high**, `claude -p --model sonnet --effort high` |

구현과 테스트가 로컬 앱과 통신해야 하는 레이어는 Terra의 `workspace-write` 샌드박스에서 막힌다(네트워크 허용으로도 안 된다). 그런 레이어는 처음부터 Sonnet에게 맡긴다. 구현자의 샌드박스는 풀지 않는다. 사용자가 그 레이어에 한해 명시적으로 허락할 때만 예외다.

### 조사·독립 검토

두 명 독립 기준은 basics 「맡길 때」를 따른다. 아래 한 행은 두 보고를 얻기 위한 기본 조합이며 메인이 어느 제품인지는 모델 선택을 바꾸지 않는다.

| 등급 | 적용할 작업 | Codex 조사자 | Claude 조사자 |
| --- | --- | --- | --- |
| 단순 조사 | 위치·사용처·명확한 사실 수집 | Luna **xhigh** | Haiku **xhigh** |
| 일반 조사 | 범위가 명확한 구조·흐름 설명, 자료·화면 확인 | Terra **high** | Sonnet **high** |
| 어려운 조사·중요한 판단 | 여러 모듈의 복잡한 상태·수명·예외 해석, 비싼 설계 결정, 데이터 보존 위험. 작업 최종 리뷰는 아래 별도 배정 | Sol **xhigh** | Opus **xhigh** |

- 읽을 양만으로 등급을 정하지 않는다. 해석 난도와 틀렸을 때의 영향도 본다. 중요한 설계 권고를 같은 요청서에 담으면 중요한 판단 등급을 쓴다.
- 작업 최종 리뷰는 아래 전용 역할표를 따른다.
- 위 강도는 기본값이다. 근거 부족·예상보다 복잡한 판단이 드러나면 범위와 난도를 재평가한다. 합의한 등급·강도를 낮추지 않는다.

<a id="에픽-최종-리뷰-2026-10-31-정함"></a>

### 작업 최종 리뷰

구현 작업을 닫기 전 같은 통합 요청서로 두 새 세션이 독립 검토한다. 각자 사용자 동작·구조·테스트와 검증 근거를 모두 살피며, Review에서 지정한 분리된 개발·시험 환경에서 직접 재현할 수 있다.

| 자리 | 기본 모델·강도 | 기본을 사용할 수 없을 때 |
|---|---|---|
| Codex 검토자 | Astra **xhigh** | Sol **xhigh**, 새 세션 |
| Claude 검토자 | Opus **xhigh** | Claude를 사용할 수 없으면 Codex 쪽의 새 세션으로 부족한 자리만 대체 |

**Claude 검토자는 Opus를 기본으로 고정한다.** Fable은 비대화형 호출에 추가 과금이 생길 수 있어 자동 선택·대체 후보에 넣지 않고 호출하지 않는다. 사용자가 나중에 모델 변경을 요청하면 구독·과금 조건을 다시 확인한다. 구독·사용량 결제 설정은 자동 변경하지 않는다.

지원·권한·한도 등의 문제로 기본을 쓸 수 없으면 해당 자리의 대체를 사용하고, 이미 완료한 다른 보고는 보존한다. CLI가 조용히 다른 모델로 바꾸거나 강도를 낮췄다면 지정한 검토가 완료된 것으로 세지 않는다. 별도 새 호출에 대체 모델과 xhigh를 명시하고 지정값·실제 모델·실패 또는 사전 대체 이유를 남긴다.

호출 범위와 실제 확인:

- 요청서는 `skills/review/references/review-request.md`, 작업 공간·시험 DB·포트 분리는 Review 스킬을 따른다. 실제 모델·권한 거절·오류·완료 여부와 실행 근거를 각각 보존한다.
- Codex는 정확한 모델·강도를 지정한 새 세션을 쓴다. 실행에 필요한 제한된 쓰기 범위만 허용한다. CLI면 각자의 작업 공간에서 `codex exec --model <위 표의 선택 모델> -c model_reasoning_effort=xhigh --sandbox workspace-write`에 요청서를 표준 입력으로 주고 JSON 실행 정보를 따로 저장한다. 보고서는 검토자가 직접 쓴다. 읽기만 허용한 기본 호출 예시와 구분한다.
- Claude는 각자의 작업 공간에서 `--model <위 표의 선택 모델> --effort xhigh --safe-mode --no-session-persistence --output-format json`을 명시한다. 실행 도구가 없는 `--permission-mode plan --tools Read,Grep,Glob` 조합으로 재현 실행을 완료했다고 보고하지 않는다. 기본 권한 검사를 유지하고 기존 승인 범위의 구체적인 명령·파일만 허용한다. 자동 실행을 위해 전체 권한 우회를 켜지 않는다.
- 도구 접근과 요청서의 범위 제한을 구분한다. 쓰기·명령 실행을 기술적으로 제한할 수 없는 도구에서는 분리한 시험 작업 공간과 실제 권한을 확인하고, 지정 범위로 실행할 수 없으면 미확인으로 보고한다. 설정만으로 안전한 격리나 실제 동작 검증이 완료됐다고 가정하지 않는다.

### 설계 후보 생성

중요한 설계는 메인과 아래 두 독립 설계자가 각각 후보와 선택 이유를 만든다. 메인은 사용자와 쌓은 맥락을 활용해 직접 설계하고, 자신의 안도 같은 기준으로 검토한다.

| 역할 | 모델·강도 | 실행 |
|---|---|---|
| 메인 설계자 | 현재 대화의 모델·강도 유지 | 두 설계자에게 요청한 뒤 다른 보고를 읽기 전에 초안과 이유·전제를 기록 |
| 독립 설계자 1 | Sol **xhigh** | 메인·설계자 2의 안을 보지 않는 새 세션 |
| 독립 설계자 2 | Opus **xhigh** | 메인·설계자 1의 안을 보지 않는 새 세션 |

- 요청서 내용, 메인 초안, 대조와 사용자 설명, 저장은 [Design 스킬](../skills/design/SKILL.md)과 [설계 요청서](../skills/design/references/decision-request.md)를 따른다. 코드와 운영 기록은 읽기만 하며 구현하지 않는다.
- 모델·강도와 실행 정보는 아래 공통 준비 절차로 확인한다. 독립 설계자의 호출 불가·실패는 일반 조사·독립 검토의 대체 표를 따르고 부족한 자리만 채운다. 메인의 모델이나 강도를 자동으로 바꾸지 않는다.

### 중요한 설계 후보의 적대적 검토

위 설계자들이 만든 후보가 요구를 깨는 상황은 아래 별도 검토자가 확인한다.

| 역할 | 모델·강도 | 실행 |
|---|---|---|
| 설계 적대 검토자 1 | Astra **xhigh** | 설계자와 분리된 새 세션 |
| 설계 적대 검토자 2 | Opus **xhigh** | 설계자·검토자 1과 분리된 새 세션 |

- 요청서에 담을 것, 검토자가 확인할 것, 지적의 처리는 [Design 스킬의 「별도 적대 검토와 확인을 거친다」](../skills/design/SKILL.md#별도-적대-검토와-확인을-거친다)를 따른다. 코드와 운영 기록은 읽기만 한다. 실제 모델·강도 확인은 아래 공통 준비 절차를 따른다.
- 실패한 자리는 같은 모델의 새 세션으로 다시 채운다. 그 모델을 쓸 수 없으면 작업 최종 리뷰와 같은 대체를 따른다. 대체했으면 보고에 적는다.

### 다른 제품 호출이 안 될 때

| 사용 가능한 환경 | 두 보고를 얻는 방법 |
| --- | --- |
| Codex와 Claude 모두 가능 | 위 역할표의 Codex·Claude 조합을 사용한다. |
| Codex만 가능 | 해당 등급의 Codex 모델로 별도 새 세션 두 개를 실행한다. |
| Claude만 가능 | 해당 등급의 Claude 모델로 별도 새 세션 두 개를 실행한다. |

한 보고가 이미 완료됐다면 보존하고 실패한 자리만 새 세션으로 채운다. 같은 모델의 두 세션도 동일 요청서를 독립적으로 조사하지만 다른 제품을 섞었을 때와 같은 다양성을 확보했다고 보고하지 않는다. 이 환경에서 호출 불가하다는 사용자 설명이나 확인한 실패가 있으면 이후 조사마다 같은 외부 호출을 반복하지 않는다.

### 특정 조사 모델을 사용할 수 없을 때

| 사용할 수 없는 조사 모델 | 같은 제품에서 시도할 대체 모델·강도 |
| --- | --- |
| Luna | Sol xhigh |
| Terra | Sol xhigh |
| Sol | Astra xhigh |
| Haiku | Sonnet high |
| Sonnet | Opus xhigh |
| Opus | 사용 가능한 Codex 모델로 실패한 자리를 채운다. |

대체 모델도 역할표의 해당 강도를 명시하고 사용 가능 여부를 확인한다. 대체할 수 있는 같은 제품 모델이 더 없으면 다른 사용 가능한 제품의 해당 등급 모델로 채운다. 인증·정책·연결 문제로 제품 전체가 안 되면 모델 이름만 바꾸며 반복하지 않는다. 필요한 두 보고를 확보할 수 없으면 완료로 표시하지 않는다. 구현자 배정은 위 구현자 표를 유지한다.

### 막혔을 때 (모든 역할)

- 호출 전에 도구가 동작하는지 한 번 확인한다. 확인 없이 일을 맡기면 원인을 늦게 안다.
- 한 번 막힌 쪽은 그 세션에서 다시 시도하지 않는다.
- 대체할 때마다 사용자에게 한 줄로 알리고 실제 모델·강도와 실패 이유를 기록한다. 조사·검토는 위 표를, 구현은 구현자 표를 따른다.
- 구현자가 레이어 중간에 바뀌는 것은 허용한다. 같은 테스트를 통과해야 한다.

## 위임 조사·독립 검토: 공통 준비와 결과 확인

개인 기준은 basics 「맡길 때」와 [프로젝트 기준 관리](project-guidance.md)대로 적는다. 원칙 표 경로와 해당 원칙(들)도 basics 「맡길 때」대로 적는다. Claude CLI의 `--safe-mode`처럼 전역 지침을 읽지 않는 호출에서도 실제 절대 경로로 표를 읽게 한다. 전용 틀이 없는 요청도 같다.

basics 「맡길 때」의 두 명 독립 기준을 모든 위임 조사에 적용한다. 시작 전에 등급과 모델·강도, 두 세션을 확보할 호출 경로를 고른다.

1. 같은 요청서 파일을 두 검토자에게 준다. 요청서에는 검토할 질문, 제품 문서와 대상 파일의 절대 경로, 허용 범위, 결과 위치를 적는다. 새 검토 세션으로 시작하고 메인의 전체 대화나 다른 검토자의 결과는 넘기지 않는다.
2. 일반 조사·설계와 읽기 중심 검토에서 코드와 운영 기록은 읽기만 한다. 맡은 에이전트가 요청서에 지정된 자기 보고서 파일을 직접 쓴다. CLI 호출에는 보고서 폴더에 쓸 권한을 준다(아래 예시의 `--add-dir`). 작업 최종 리뷰의 재현 실행·쓰기 범위는 전용 역할표와 요청서를 따른다. 요청서에는 두 경로를 모두 미리 적되 각 검토자가 자기 보고서만 보게 한다.
3. CLI의 종료 코드와 오류 여부, 빈 응답·권한 거절·한도 도달 여부를 확인한다. 실패 출력은 리뷰 결과로 취급하지 않는다. 보고서 외에 CLI의 모델 실행 정보도 프로젝트 기록 폴더에 보존한다.
4. 모델·추론 강도의 지정값과 실제 실행 메타데이터를 비교한다. 모델이 스스로 말하는 이름만으로 확인하지 않는다. 별칭을 썼다면 실제 모델 ID를 기록한다. 확인 정보가 없으면 모델·강도 미확인으로 보고한다. 도움말·캐시·설정 파일만으로 실제 호출 성공을 주장하지 않는다.
5. 호출 불가·인증 만료·모델 불일치가 있으면 메인에게 알리고 위의 대체 경로를 따른다. 메인이 대신 쓴 답을 독립 의견으로 세지 않는다. 이미 제출된 보고서를 덮어쓰지 않는다. 실패·빈 응답·미완성 보고는 완료 인원에 넣지 않는다.
6. 검토자는 추가 검토자를 호출하지 않는다. 메인이 두 결과를 읽고 근거와 이견을 비교하며, 제품 결정은 사용자에게 남긴다.

## CLI 호출 예시

작업 디렉터리는 검토 대상 저장소다. 아래 경로는 해당 프로젝트의 실제 요청서·기록 폴더로 바꾼다. 셸 변수에는 경로만 담고 인용한다. 요청서 본문을 셸 코드로 보간하지 않는다. 로그인 준비는 [README의 도구별 설정](../README.md#독립-검토를-위한-cli-준비)을 따른다.

### Claude 조사자

아래는 일반 조사 예시다. 다른 등급은 역할표에 맞게 모델과 강도를 함께 바꾼다. 각 호출은 별도 새 세션이고 두 조사자에게 같은 요청서 파일을 입력한다.

```sh
request_file='/absolute/path/to/request.md'
report_dir='/absolute/path/to/tasks/<작업 이름>'
raw_file="$report_dir/research-2-run.json"
research_claude_model='sonnet'
research_claude_effort='high'
claude -p --model "$research_claude_model" --effort "$research_claude_effort" --safe-mode --permission-mode acceptEdits \
  --tools 'Read,Grep,Glob,Write' --add-dir "$report_dir" --no-session-persistence \
  --output-format json < "$request_file" > "$raw_file"
```

`--safe-mode`로 사용자·프로젝트 맞춤 지침과 훅·외부 MCP 설정이 검토에 영향을 주지 않게 한다. 필요한 판단 기준은 요청서에서 명시한다. 허용 도구는 파일 읽기·검색과 보고서 쓰기다. 검토자는 요청서의 보고서 경로에 직접 쓴다. 실행 정보 JSON의 `is_error`, `modelUsage`, `permission_denials`와 실행 강도를 확인하고, 지정한 보고서 파일이 생겼는지 본다. 읽기 권한 부족으로 자료를 보지 못했다면 완료로 판단하지 않는다. 별칭을 썼다면 실제 모델 ID도 확인한다.

### Codex 조사자

```sh
request_file='/absolute/path/to/request.md'
report_dir='/absolute/path/to/tasks/<작업 이름>'
events_file="$report_dir/research-1-events.jsonl"
research_codex_model="$(~/workspace/hstack/scripts/codex-model.sh terra)"
research_codex_effort='high'
codex exec --model "$research_codex_model" -c "model_reasoning_effort=$research_codex_effort" --sandbox workspace-write \
  --add-dir "$report_dir" --json - \
  < "$request_file" > "$events_file"
```

검토자는 요청서의 보고서 경로에 직접 쓴다. 쓰기 권한이 있어도 요청서에 "코드와 기록은 읽기만 하고 자기 보고서만 쓴다"를 명시한다. Codex는 기존 전역·프로젝트 지침도 읽으므로, 요청서에 검토 범위와 재위임 금지를 명시한다.
실행 이벤트에는 실제 모델 정보가 없다. 첫 이벤트의 `thread_id`로 `~/.codex/sessions/` 아래 세션 기록을 찾아 `model`과 `effort`를 확인한다. 그래서 `--ephemeral`(세션 기록을 남기지 않음)을 쓰지 않는다. `--model`을 지정했다는 이유만으로 실제 모델을 확인했다고 보고하지 않는다.

## 구현자 호출

요청서는 `skills/layer/references/layer-request.md`(레이어) 또는 `skills/prototype/references/prototype-request.md`(시제품)의 틀로 쓴다. 호출 전에 도구가 동작하는지 한 번 확인한다. 프롬프트는 "요청서를 읽고 그대로 수행해라: <경로>. 지킬 것을 반드시 지킨다. 마지막 답은 보고서 경로 한 줄."이다.

### Terra (기본)

```sh
request_file='/absolute/path/to/brief.md'
report_file='/absolute/path/to/last-message.md'
events_file='/absolute/path/to/events.jsonl'
cd /absolute/path/to/workdir   # 레이어는 프로젝트(또는 격리한 복사본), 시제품은 새 폴더
codex exec -m "$(~/workspace/hstack/scripts/codex-model.sh terra)" -c model_reasoning_effort=high --sandbox workspace-write \
  --json -o "$report_file" "요청서를 읽고 그대로 수행해라: $request_file. 지킬 것을 반드시 지킨다. 마지막 답은 보고서 경로 한 줄." \
  < /dev/null > "$events_file"
```

쓰기는 작업 폴더 안으로 한정된다. 요청서 틀 맨 앞의 "너는 구현 에이전트다" 줄이 필요하다. Codex는 전역 지침(`basics.md`의 "테스트는 메인이, 일반 구현은 구현 에이전트가 쓴다")도 읽으므로 구현 담당임을 분명히 해야 한다. 도구를 꺼 둔 별도 Codex 홈을 쓰면 안 된다(실행 도구가 꺼져 파일도 읽지 못한다).

### Sonnet

메인이 어느 도구든 Claude Code CLI로 부른다. 허용 도구에 그 프로젝트의 테스트 명령을 넣는다. `git -C`, `python -c`처럼 테스트가 부르는 명령도 넣는다.

```sh
cd /absolute/path/to/workdir
claude -p --model sonnet --effort high --safe-mode --no-session-persistence --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Bash(<테스트 명령>:*),Bash(git status:*),Bash(git diff:*)" \
  --output-format json "요청서를 읽고 그대로 수행해라: <요청서 경로>. 지킬 것을 반드시 지킨다. 마지막 답은 보고서 경로 한 줄." > "$raw_file"
```

완료 후 JSON의 `is_error`, `modelUsage`(실제 모델 ID), `permission_denials`를 확인한다.

## 처음 쓸 때 확인할 것

- Codex가 메인일 때 `claude -p` Sonnet의 허용 도구에 브라우저 테스트 명령을 넣으면 로컬 앱과 통신되는지 처음 쓸 때 확인한다.

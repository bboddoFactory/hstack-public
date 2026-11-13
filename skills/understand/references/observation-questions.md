# 상황별 관찰 질문

이해하려는 질문에 해당하는 부분만 읽는다. 아래 원칙은 현재 구조를 관찰하는 기준이다. 설계 원문의 구조 변경 행동을 이해 단계에서 자동 실행하지 않는다.

[작업과 기록의 기준](../../../docs/work-records.md)에 따라 현재 작업 파일이 지정한 범위와 상세 문서를 관찰의 입력으로 삼는다. 옛 보고 전체를 현재 지침으로 취급하지 않으며 충돌은 메인에게 알린다.

| 상황 | 참고할 원칙(들) | 현재 구조에서 확인할 것 |
|---|---|---|
| 데이터와 상태가 핵심이다 | Foundational Thinking, Model the Domain | 무엇이 한 건인지, 상태를 누가 소유·변경하는지, 수명이 언제 끝나는지와 규칙이 어디에 표현되는지 |
| 여러 작업이 동시에 실행되거나 결과가 늦게 온다 | Foundational Thinking, Separate Before Serializing Shared State | 실제로 공유·변경하는 대상과 작업 구분, 취소·종료 이후의 결과가 어디로 가는지 |
| 외부 입력·통신·실패 처리가 있다 | Boundary Discipline | 실제 시스템 경계, 검사·변환·오류 전달의 위치와 각 부분이 기대는 보장 |
| 흐름이 길거나 설명하기 어렵다 | Minimize Reader Load | 결과까지 따라가는 단계와 숨은 상태, 각 부분이 맡는 책임 |
| 동작 여부를 답하거나 조사를 끝낸다 | Prove It Works | 코드로 읽은 흐름과 직접 실행한 범위, 실제 값·결과와 아직 확인하지 못한 조건 |
| 선택한 이유를 묻는다 | 원칙 아님: 선택 배경의 근거 구분(pstack Why 스킬) | 당시 문서·주석·변경 이력으로 확인한 이유와 현재 코드에서 추론한 설명의 차이 |

데이터·동시 작업·경계·이해 부담의 배경과 원칙 출처가 필요하면 [설계 원칙 참고](../../../docs/design-principles-reference.md)의 해당 절을 읽는다. 관찰 결과를 원칙의 이상적인 구조에 억지로 맞추지 않는다. 예를 들어 저장소 하나를 공유해도 작업별 데이터는 분리될 수 있고, 계층이 많아도 각 계층이 실제 복잡함을 줄일 수 있다.

완료 주장의 근거는 Pstack의 [Prove It Works](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-prove-it-works/SKILL.md)를 참고한다. 선택 배경의 확실성은 [Why](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/why/SKILL.md), 질문의 크기에 맞는 설명은 [Teach](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/teach/SKILL.md)를 참고했다. Hstack에서는 전체 자료 조사나 별도 설명자 위임을 매번 강제하지 않는다.

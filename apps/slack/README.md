# 열정 슬랙 Windows 설치 프로그램

Windows 10/11 64비트용. `/slack`을 독립 창으로 열고 같은 계정·같은 대화·파일을 사용한다.
기존 열톡 앱과 프로그램 ID·프로필·설치 경로·업데이트 피드가 다르다.

## 사용
1. `passion-slack-setup-0.1.0.exe` 실행 → 현재 사용자에 설치.
2. 바탕화면 「열정 슬랙」 → 인트라넷 계정으로 로그인. 다른 PC에서는 그 PC에서 처음 로그인한다.
3. 창 닫기는 트레이 숨김이다. 완전 종료·업데이트 확인·자동 실행 설정은 상단/트레이 메뉴에서 한다.
4. 상단 「열정 슬랙 → 열톡 열기」로 같은 로그인 세션의 작은 열톡 창을 연다.

## 업데이트
- 인트라넷 화면·업무 로직은 서버 배포 후 재실행/새로고침으로 반영된다. 작성 중 강제 새로고침은 하지 않는다.
- 프로그램은 전용 generic 피드에서 자동 다운로드, 명시적 종료/재시작 때 설치한다.
- 첫 전용 피드를 공개하기 전에는 업데이트 연결 확인 필요가 표시된다. 프로그램과 로그인은 계속 사용할 수 있다.
- 피드: `https://github.com/timeofpassion/yeoltalk-desktop/releases/download/passion-slack-updates/`
- 기존 열톡 `releases/latest`와 분리된 prerelease를 쓴다. 직원 토큰·회사 비밀번호를 배포 파일에 넣지 않는다.
- 이 PR을 main에 반영하면 전용 workflow가 테스트·설치파일 빌드·전용 prerelease 공개를 수행한다. 이후 프로그램 변경은 package.json 버전을 올려 PR→승인·머지한다. 같은/낮은 버전 재공개는 차단한다.
- 인증서가 제공되지 않아 이번 설치파일은 서명되지 않았다. Windows에서 게시자 미확인 안내가 표시될 수 있다. 보안 경고를 자동으로 해제하는 코드는 없다.

## 개발자용 근거
```powershell
npm ci --prefix apps/slack
npm test --prefix apps/slack
npm run dist --prefix apps/slack
node apps/slack/scripts/publish.cjs
```
실제 계정·직원에게 메시지를 보내는 시험은 하지 않는다. 로그인 쿠키의 재시작 유지와 실제 NSIS 파일 다운로드/해시는 격리된 Electron 런타임으로 검사한다. 다른 실물 PC 설치·회사 계정 로그인·운영 피드를 통한 설치 교체는 별도 검증 대상이다.

# 계약소포 도우미

계약소포 영업 담당자용 모바일 앱입니다. 요금 계산, 제안서 작성과 문자 발송, 고객 관리를 할 수 있습니다.
Capacitor 6으로 만든 Android 앱이고, 웹 코드는 `www/`에 있습니다.

## 구조
- `www/rates.js`: 기본 요금표·감액 규칙 데이터. **출시 전 최신 고시와 대조해야 합니다.**
- `www/app.js`: 앱 로직 (계산 / 제안서 / 고객 / 설정)
- `www/index.html`, `www/styles.css`: 화면
- `android/`: Capacitor가 만든 Android 프로젝트

- `www/sellers.js`: 업체 찾기. 공정위 통신판매사업자 등록현황 CSV(공공데이터포털)를 불러와 검색합니다. UTF-8과 EUC-KR 파일을 모두 읽을 수 있습니다.
- `www/guide.js`: 업무지침 화면. 앱에 포함된 `www/guide.pdf`(우체국 계약소포업무 처리지침, 118쪽)를 보여 주고, 본문 찾기를 지원합니다. 찾은 단어는 형광 노랑으로, 현재 결과는 형광 연두로 표시합니다. 띄어쓰기는 무시하고 찾습니다. 두 손가락으로 100~400% 확대할 수 있고(PC는 Ctrl+휠), 확대하면 가로로도 넘겨 봅니다. 확대 후에는 그 배율로 다시 그려 글자가 선명합니다. 요금 산출 기준 요약도 함께 보여 줍니다.
  - pdf.js 3.11.174를 `www/vendor`에 포함했습니다(CMaps·표준 글꼴 포함). 화면 근처의 쪽만 그리고, 동시에 최대 8쪽까지만 유지합니다.
  - 지침을 새 판으로 바꾸려면 `www/guide.pdf`를 교체한 뒤 `npm run apk`를 실행하세요.

모든 데이터는 기기 안에만 저장하고 서버로 보내지 않습니다. 고객과 견적은 localStorage에, 업체 목록과 PDF는 IndexedDB에 저장합니다. 백업은 설정 탭의 내보내기와 가져오기로 합니다.

## 개발
```bash
npm run serve
```
http://127.0.0.1:5173 에서 확인합니다.

## Android 빌드
1. Android Studio를 열고 SDK Manager에서 Android SDK Platform 34와 Build-Tools를 설치합니다. 라이선스 동의도 이때 합니다.
2. 아래 명령으로 디버그 APK를 만듭니다.
   ```bash
   npm run apk
   ```
   결과물은 `android/app/build/outputs/apk/debug/app-debug.apk`에 생깁니다.
3. 또는 `npm run open`으로 Android Studio에서 열어 실행합니다.

웹 코드를 고친 뒤에는 `npm run sync`를 실행해야 앱에 반영됩니다.

## 앱 업데이트 (GitHub)
앱의 설정 탭 → **업데이트 확인** 버튼으로 새 버전을 받습니다. 앱을 켤 때도 자동으로 확인해서, 새 버전이 있으면 설정 탭에 점을 표시합니다.

- **화면·로직·데이터 수정** (`www/` 안의 파일): 버튼만 누르면 새 화면 묶음(zip)을 받아 바로 적용합니다. 묶음은 SHA-256으로 검증하고, 새 버전이 정상 시작되지 않으면 이전 버전으로 되돌립니다(`@capgo/capacitor-updater` 수동 모드, 통계 전송 끔).
- **네이티브 수정** (플러그인·권한·아이콘·앱 이름): 새 APK가 필요합니다. 앱이 내려받기 링크를 보여 주고, 설치는 사용자가 직접 누릅니다.

배포 명령 (프로젝트 폴더에서):
```bash
python scripts/release.py --notes "변경 내용"
```
```bash
python scripts/release.py --apk --notes "변경 내용"
```
- 배포 파일은 `scripts/release_config.json`에 적은 공개 저장소에 올라갑니다. 앱은 `updates/version.json`을 보고 새 버전을 확인합니다.
- GitHub CLI는 `tools/gh`에 있습니다(GitHub에는 올리지 않음).
- **서명 키 `android/keystore/`는 절대 잃어버리거나 GitHub에 올리지 마세요.** 키가 바뀌면 기존 앱 위에 업데이트 APK를 설치할 수 없습니다.

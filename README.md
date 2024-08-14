# 📊기업맞춤형 AI면접 플랫폼 AIT
> **KT AIVLE SCHOOL 5기 11조 빅프로젝트**<br/> **개발기간: 2024.07**
>

## 🔗Link(시연영상 링크)
 - https://youtu.be/8Z8Ex54-4CM
> <br>

## 행동 분석 서버
Vladimir Mandic의 Human이라는 오픈 라이브러리 사용
 - https://github.com/vladmandic/human

### 요구 사항
```
Node.js >= 16.x
NPM >= 7.x
```

### 환경
```
name == AIT_Vision
main == work1.js
start == node work1.js

dependencies:
  @tensorflow/tfjs-node == ^4.2.0
  @vladmandic/pilogger == ^3.0.0
  cors == ^2.8.5
  express == ^4.18.2
  multer == ^1.4.5-lts.1
  pipe2jpeg == ^1.0.7
```

### 설치 방법
1. 저장소를 클론합니다:
   ```bash
   git clone https://github.com/AIVLE11-AIT/AIT-Vision.git
   cd AIT-Vision
   ```

2. 의존성을 설치합니다:
   ```
   npm install --dev
   ```
   
3. 서버 실행
   ```
   node work1.js
   ```

### 패키지 구조
 - `work1.js`: 비디오 업로드를 처리하고 워커 프로세스를 생성하는 메인 서버 파일입니다.
 - `videoProcessor.js`: 비디오를 처리하고 정보를 추출하는 워커 스크립트입니다.

const { parentPort, workerData } = require('worker_threads');
const spawn = require('child_process').spawn;
const fs = require('fs');
const Pipe2Jpeg = require('pipe2jpeg');
const Human = require('./dist/human.node.js');
const log = require('@vladmandic/pilogger');

let count = 0; // 프레임 카운터
let busy = false; // 처리 중 플래그
let inputFile = workerData.filePath; // 기본 입력 파일

const emotionsList = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral'];

const faceGestures = [
  'facing left', 'facing center', 'facing right',
  'blink left eye', 'blink right eye',
  'mouth 0% open', 'mouth 50% open', 'mouth 100% open',
  'head up', 'head down'
];

const irisGestures = [
  'looking left', 'looking right', 'looking up', 'looking down', 'looking center'
];

const bodyGestures = [
  'leaning left', 'leaning right',
  'raise left hand', 'raise right hand',
  'i give up'
];

const handGestures = [
  'thumb forward', 'index forward', 'middle forward', 'ring forward', 'pinky forward',
  'thumb up', 'index up', 'middle up', 'ring up', 'pinky up',
  'victory', 'thumbs up'
];

const weights = {
  'angry': 16,
  'disgust': 18,
  'fear': 18,
  'sad': 12,
  'surprise': 10
};

let handCount = 0; // hand 제스처 카운터
let totalEmotionScore = 0; // 전체 감정 점수 합계
let faceMinusCount = 0; // face 제스처 카운터
let bodyMinusCount = 0; // body 제스처 카운터
let eyetrackMinusCount = 0; // eye 제스처 카운터
let noemotionFrameCount = 0; // emotion이 감지되지 않는 프레임 수

const maxScore = 20;

const scaleEmotionsTo20 = (emotions) => {
  // 감정 점수와 가중치를 곱한 감점 값 합산
  const totalDeduction = emotions.reduce((sum, emotion) => {
    if (weights[emotion.emotion] !== undefined) {
      return sum + (parseFloat(emotion.score) * weights[emotion.emotion]);
    }
    return sum;
  }, 0);

  // 20점에서 감점 값을 빼서 최종 점수 계산
  const scaledScore = maxScore - totalDeduction;
  return Math.max(scaledScore, 0).toFixed(2); // 점수는 최소 0으로 제한
};

const saveDetectedResult = (result) => {
  const uniqueGestures = [...new Set(result.gesture?.map(gesture => gesture.gesture))];

  const categorizedGestures = {
    face: uniqueGestures.filter(gesture => faceGestures.includes(gesture)),
    iris: uniqueGestures.filter(gesture => irisGestures.includes(gesture)),
    body: uniqueGestures.filter(gesture => bodyGestures.includes(gesture)),
    hand: uniqueGestures.filter(gesture => handGestures.includes(gesture)),
  };

  // 얼굴 제스처 카운트
  const faceGesturesToCount = ['facing left', 'facing right', 'head up', 'head down'];
  const currentFaceMinusCount = faceGesturesToCount.filter(gesture => categorizedGestures.face.includes(gesture)).length;
  faceMinusCount += currentFaceMinusCount;

  // 신체 제스처 카운트
  const bodyGesturesToCount = ['leaning left', 'leaning right', 'raise left hand', 'raise right hand', 'i give up'];
  const currentBodyMinusCount = bodyGesturesToCount.filter(gesture => categorizedGestures.body.includes(gesture)).length;
  bodyMinusCount += currentBodyMinusCount;

  // 눈 추적 제스처 카운트
  const eyetrackGesturesToCount = ['looking left', 'looking right', 'looking up', 'looking down'];
  const currentEyetrackMinusCount = eyetrackGesturesToCount.filter(gesture => categorizedGestures.iris.includes(gesture)).length;
  eyetrackMinusCount += currentEyetrackMinusCount;

  if (categorizedGestures.hand.length > 0) {
    handCount++;
  }

  const emotionsWithDefault = (emotions) => {
    const emotionMap = {};
    emotions.forEach(emotion => {
      emotionMap[emotion.emotion] = emotion.score;
    });
    return emotionsList.map(emotion => ({
      emotion,
      score: (emotionMap[emotion] || 0).toFixed(2)
    }));
  };

  const emotions = result.face?.map(face => emotionsWithDefault(face.emotion))?.flat();
  let scaledEmotionScore = 0;
  if (emotions.every(emotion => parseFloat(emotion.score) === 0)) {
    noemotionFrameCount++;
  } else {
    scaledEmotionScore = scaleEmotionsTo20(emotions);
    totalEmotionScore += parseFloat(scaledEmotionScore);
  }

  const filteredResult = {
    frame: count,
    face: result.face?.map(face => ({
      emotion: emotionsWithDefault(face.emotion),
      distance: face.distance.toFixed(2)
    })),
    gesture: categorizedGestures,
    hand_count: handCount,
    noemotion_frame_count: noemotionFrameCount,
    face_minus_count: faceMinusCount,
    body_minus_count: bodyMinusCount,
    eyetrack_minus_count: eyetrackMinusCount,
    emotion_score: scaledEmotionScore
  };
  detectionResults.push(filteredResult);
  parentPort.postMessage({ type: 'log', data: `Frame result saved: ${JSON.stringify(filteredResult)}` });
};

const humanConfig = {
  modelBasePath: 'file://models/',
  debug: false,
  async: true,
  filter: { enabled: false },
  face: {
    enabled: true,
    detector: { enabled: true, rotation: false },
    mesh: { enabled: true },
    iris: { enabled: true },
    description: { enabled: true },
    emotion: { enabled: true },
  },
  hand: { enabled: true },
  body: { enabled: true },
  object: { enabled: false },
};

const human = new Human.Human(humanConfig);
let pipe2jpeg = new Pipe2Jpeg();

const logFileName = 'face_detection_results.json'; // 저장할 파일 이름
let detectionResults = []; // 감지 결과를 저장할 배열

const ffmpegPath = 'ffmpeg'; // ffmpeg 경로를 설정합니다.

function prepareLogFile() {
  fs.writeFileSync(logFileName, ''); // 기존 파일 내용을 초기화하거나 새 파일 생성
  parentPort.postMessage({ type: 'log', data: 'Log file prepared' });
}

const saveFinalResults = () => {
  const validEmotionFrameCount = count - noemotionFrameCount;
  const noEmotionThreshold = count * 0.3; // 전체 프레임의 30%

  let finalResults;

  if (noemotionFrameCount >= noEmotionThreshold) {
    // noemotion_frame_count가 전체 프레임의 30% 이상인 경우 모든 점수를 0점으로 설정
    finalResults = {
      action_score: 0.00,
      hand_count_score: 0.00,
      emotion_score: 0.00,
      face_gesture_score: 0.00,
      body_gesture_score: 0.00,
      eyetrack_gesture_score: 0.00
    };
  } else {
    // 그렇지 않은 경우 정상적으로 점수 계산
    const hand_count_score = Math.max(0, (10 - ((handCount / count) * 10))).toFixed(2);
    const averageEmotionScore = validEmotionFrameCount > 0 ? Math.max(0, (totalEmotionScore / validEmotionFrameCount)).toFixed(2) : "0.00";
    const face_gesture_score = Math.max(0, (30 - ((faceMinusCount / count) * 30))).toFixed(2);
    const body_gesture_score = Math.max(0, (10 - ((bodyMinusCount / count) * 10))).toFixed(2);
    const eyetrack_gesture_score = Math.max(0, (30 - ((eyetrackMinusCount / count) * 30))).toFixed(2);
    const action_score = (
      parseFloat(hand_count_score) +
      parseFloat(averageEmotionScore) +
      parseFloat(face_gesture_score) +
      parseFloat(body_gesture_score) +
      parseFloat(eyetrack_gesture_score)
    ).toFixed(2);

    finalResults = {
      action_score: parseFloat(action_score),
      hand_count_score: parseFloat(hand_count_score),
      emotion_score: parseFloat(averageEmotionScore),
      face_gesture_score: parseFloat(face_gesture_score),
      body_gesture_score: parseFloat(body_gesture_score),
      eyetrack_gesture_score: parseFloat(eyetrack_gesture_score)
    };
  }

  // finalResults를 JSON 파일로 저장
  fs.writeFileSync('finalResults.json', JSON.stringify(finalResults, null, 2));
  parentPort.postMessage({ type: 'log', data: 'Final results saved to finalResults.json' });
  parentPort.postMessage({ type: 'result', data: finalResults });
};

async function detect(jpegBuffer) {
  if (busy) return; // 처리 중이면 건너뜀
  busy = true;
  count++;
  const tensor = human.tf.node.decodeJpeg(jpegBuffer, 3); // JPEG 버퍼를 텐서로 디코딩
  const res = await human.detect(tensor);
  human.tf.dispose(tensor); // 텐서 해제
  parentPort.postMessage({ type: 'log', data: `frame ${count}: size ${jpegBuffer.length}, shape ${tensor.shape}, face ${res?.face?.length}, body ${res?.body?.length}, hand ${res?.hand?.length}, gesture ${res?.gesture?.length}` });

  saveDetectedResult(res); // 감지 결과를 파일에 저장

  busy = false;
}

async function main() {
  const ffmpegParams = [
    '-loglevel', 'quiet', // 에러 로그를 출력하도록 설정
    '-i', `${inputFile}`, // 입력 파일
    '-an', // 오디오 제거
    '-c:v', 'mjpeg', // Motion JPEG 사용
    '-pix_fmt', 'yuvj422p', // 픽셀 형식 설정
    '-vf', 'fps=10', // 초당 10프레임으로 설정
    '-f', 'image2pipe', // 이미지를 파이프로 출력
    'pipe:1', // 파이프로 출력
  ];

  prepareLogFile(); // 로그 파일 초기화
  await human.tf.ready(); // TensorFlow.js 준비 완료 대기
  parentPort.postMessage({ type: 'log', data: `Human version: ${human.version}, TensorFlow.js version: ${human.tf.version_core}` });
  parentPort.postMessage({ type: 'log', data: `Processing input file: ${inputFile}` });

  pipe2jpeg = new Pipe2Jpeg();
  const detectWrapper = (jpegBuffer) => detect(jpegBuffer);
  pipe2jpeg.on('data', detectWrapper); // pipe2jpeg의 데이터 이벤트 처리

  const ffmpeg = spawn(ffmpegPath, ffmpegParams, { stdio: ['ignore', 'pipe', 'pipe'] });
  ffmpeg.on('error', (error) => {
    parentPort.postMessage({ type: 'log', data: `ffmpeg error: ${error}` });
  });
  ffmpeg.stderr.on('data', (data) => {
    parentPort.postMessage({ type: 'log', data: `ffmpeg stderr: ${data.toString()}` });
  });
  ffmpeg.on('exit', async (code, signal) => {
    parentPort.postMessage({ type: 'log', data: `ffmpeg exit: code ${code}, signal ${signal}` });
    pipe2jpeg.removeListener('data', detectWrapper); // ffmpeg 프로세스 종료 시 데이터 이벤트 리스너 제거

    saveFinalResults(); // 최종 결과를 저장
  });
  ffmpeg.stdout.pipe(pipe2jpeg); // ffmpeg 출력 파이프를 pipe2jpeg로 연결
}

main();

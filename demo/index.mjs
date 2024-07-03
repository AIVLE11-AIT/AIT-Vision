import { Human } from '../nodejs/node.js'; // Human 라이브러리 로드
import { createCanvas, loadImage } from 'canvas';

let human;

let userConfig = {
  face: { enabled: true, detector: {}, mesh: {}, iris: {}, description: {}, emotion: {} },
  body: { enabled: true },
  hand: { enabled: true },
  gesture: { enabled: true },
};

const drawOptions = {
  bufferedOutput: true,
  drawBoxes: true,
  drawGaze: true,
  drawLabels: true,
  drawGestures: true,
  drawPolygons: true,
  drawPoints: false,
  fillPolygons: false,
  useCurves: false,
  useDepth: true,
};

let frameCount = 0;
const detectedResults = []; // 프레임마다 결과 저장할 배열

let handCount = 0; // hand 제스처 카운터
let totalEmotionScore = 0; // 전체 감정 점수 합계
let faceMinusCount = 0; // face 제스처 카운터
let bodyMinusCount = 0; // body 제스처 카운터
let eyetrackMinusCount = 0; // eye 제스처 카운터
let noemotionFrameCount = 0; // emotion이 감지되지 않는 프레임 수

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
  "angry": 16,
  "disgust": 18,
  "fear": 18,
  "sad": 12,
  "surprise": 10
};

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
    frame: frameCount,
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
  detectedResults.push(filteredResult);
  console.log('Frame result saved:', filteredResult);
};

const saveFinalResults = () => {
  const validEmotionFrameCount = frameCount - noemotionFrameCount;
  const noEmotionThreshold = frameCount * 0.3; // 전체 프레임의 30%

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
    const hand_count_score = (10 - ((handCount / frameCount) * 10)).toFixed(2);
    const averageEmotionScore = validEmotionFrameCount > 0 ? (totalEmotionScore / validEmotionFrameCount).toFixed(2) : "0.00";
    const face_gesture_score = (30 - ((faceMinusCount / frameCount) * 30)).toFixed(2);
    const body_gesture_score = (10 - ((bodyMinusCount / frameCount) * 10)).toFixed(2);
    const eyetrack_gesture_score = (30 - ((eyetrackMinusCount / frameCount) * 30)).toFixed(2);
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

  return finalResults;
};

async function initHuman() {
  human = new Human(userConfig);
  await human.load();
}

async function processVideoFrame(framePath) {
  const canvas = createCanvas(640, 480);
  const ctx = canvas.getContext('2d');
  const image = await loadImage(framePath);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = await human.detect(canvas);
  frameCount++;
  saveDetectedResult(result);
  return result;
}

export { initHuman, processVideoFrame, saveFinalResults };

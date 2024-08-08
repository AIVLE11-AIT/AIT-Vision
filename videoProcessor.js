const { spawn } = require('child_process');
const fs = require('fs');
const Pipe2Jpeg = require('pipe2jpeg');
const log = require('@vladmandic/pilogger');
const tf = require('@tensorflow/tfjs-node'); // tfjs-node 모듈을 로드합니다.
const Human = require('./dist/human.node.js');

let count = 0;
let busy = false;
let inputFile = process.env.FILE_PATH; // 환경 변수에서 파일 경로를 가져옵니다.
const ffmpegPath = process.env.FFMPEG_PATH; // 환경 변수에서 ffmpeg 경로를 가져옵니다.

const emotionsList = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral'];
const faceGestures = ['facing left', 'facing center', 'facing right', 'blink left eye', 'blink right eye', 'mouth 0% open', 'mouth 50% open', 'mouth 100% open', 'head up', 'head down'];
const irisGestures = ['looking left', 'looking right', 'looking up', 'looking down', 'looking center'];
const bodyGestures = ['leaning left', 'leaning right', 'raise left hand', 'raise right hand', 'i give up'];
const handGestures = ['thumb forward', 'index forward', 'middle forward', 'ring forward', 'pinky forward', 'thumb up', 'index up', 'middle up', 'ring up', 'pinky up', 'victory', 'thumbs up'];
const weights = { 'angry': 16, 'disgust': 18, 'fear': 18, 'sad': 12, 'surprise': 10 };

let handCount = 0;
let totalEmotionScore = 0;
let faceMinusCount = 0;
let bodyMinusCount = 0;
let eyetrackMinusCount = 0;
let noemotionFrameCount = 0;

const maxScore = 20;
const logFileName = 'face_detection_results.json'; 
let detectionResults = [];

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

const scaleEmotionsTo20 = (emotions) => {
  const totalDeduction = emotions.reduce((sum, emotion) => {
    if (weights[emotion.emotion] !== undefined) {
      return sum + (parseFloat(emotion.score) * weights[emotion.emotion]);
    }
    return sum;
  }, 0);

  const scaledScore = maxScore - totalDeduction;
  return Math.max(scaledScore, 0).toFixed(2);
};

const saveDetectedResult = (result) => {
  const uniqueGestures = [...new Set(result.gesture?.map(gesture => gesture.gesture))];

  const categorizedGestures = {
    face: uniqueGestures.filter(gesture => faceGestures.includes(gesture)),
    iris: uniqueGestures.filter(gesture => irisGestures.includes(gesture)),
    body: uniqueGestures.filter(gesture => bodyGestures.includes(gesture)),
    hand: uniqueGestures.filter(gesture => handGestures.includes(gesture)),
  };

  const faceGesturesToCount = ['facing left', 'facing right', 'head up', 'head down'];
  const currentFaceMinusCount = faceGesturesToCount.filter(gesture => categorizedGestures.face.includes(gesture)).length;
  faceMinusCount += currentFaceMinusCount;

  const bodyGesturesToCount = ['leaning left', 'leaning right', 'raise left hand', 'raise right hand', 'i give up'];
  const currentBodyMinusCount = bodyGesturesToCount.filter(gesture => categorizedGestures.body.includes(gesture)).length;
  bodyMinusCount += currentBodyMinusCount;

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
  process.send({ type: 'log', data: `Frame result saved: ${JSON.stringify(filteredResult)}` });
};

const saveFinalResults = () => {
  const validEmotionFrameCount = count - noemotionFrameCount;
  const noEmotionThreshold = count * 0.3;

  let finalResults;

  if (noemotionFrameCount >= noEmotionThreshold) {
    finalResults = {
      action_score: 0.00,
      hand_count_score: 0.00,
      emotion_score: 0.00,
      face_gesture_score: 0.00,
      body_gesture_score: 0.00,
      eyetrack_gesture_score: 0.00
    };
  } else {
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

  fs.writeFileSync('finalResults.json', JSON.stringify(finalResults, null, 2));
  process.send({ type: 'log', data: 'Final results saved to finalResults.json' });
  process.send({ type: 'result', data: finalResults });
};

async function detect(jpegBuffer) {
  if (busy) return;
  busy = true;
  count++;
  const tensor = tf.node.decodeJpeg(jpegBuffer, 3);
  const res = await human.detect(tensor);
  tf.dispose(tensor);

  process.send({ type: 'log', data: `frame ${count}: size ${jpegBuffer.length}, shape ${tensor.shape}, face ${res?.face?.length}, body ${res?.body?.length}, hand ${res?.hand?.length}, gesture ${res?.gesture?.length}` });

  saveDetectedResult(res);

  busy = false;
}

async function main() {
  const ffmpegParams = [
    '-loglevel', 'quiet',
    '-i', `${inputFile}`,
    '-an',
    '-c:v', 'mjpeg',
    '-pix_fmt', 'yuvj422p',
    '-vf', 'fps=10',
    '-f', 'image2pipe',
    'pipe:1',
  ];

  await tf.ready();
  process.send({ type: 'log', data: `Human version: ${human.version}, TensorFlow.js version: ${tf.version_core}` });
  process.send({ type: 'log', data: `Processing input file: ${inputFile}` });

  pipe2jpeg = new Pipe2Jpeg();
  const detectWrapper = (jpegBuffer) => detect(jpegBuffer);
  pipe2jpeg.on('data', detectWrapper);

  const ffmpeg = spawn(ffmpegPath, ffmpegParams, { stdio: ['ignore', 'pipe', 'pipe'] });
  ffmpeg.on('error', (error) => {
    process.send({ type: 'log', data: `ffmpeg error: ${error}` });
  });
  ffmpeg.stderr.on('data', (data) => {
    process.send({ type: 'log', data: `ffmpeg stderr: ${data.toString()}` });
  });
  ffmpeg.on('exit', async (code, signal) => {
    process.send({ type: 'log', data: `ffmpeg exit: code ${code}, signal ${signal}` });
    pipe2jpeg.removeListener('data', detectWrapper);

    saveFinalResults();
  });
  ffmpeg.stdout.pipe(pipe2jpeg);
}

main();
